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

  step(4, 'The Employees card fills its space, then scrolls');
  const scroller = await page.evaluate(() => {
    const tile = document.querySelector('[data-tile-id="employees"]');
    const list = tile?.querySelector('.tma-portal-employees');
    if (!tile || !list) return null;

    // Once the board is packed the panel *body* is the scroll container and
    // the list is unbounded inside it; before that the list caps itself. Ask
    // whichever one is actually scrolling.
    const body = tile.querySelector('.tma-portal-panel__body');
    const box = body && body.scrollHeight > body.clientHeight ? body : list;

    const rows = Array.from(list.querySelectorAll('.tma-portal-employee'));
    const boxRect = box.getBoundingClientRect();

    return {
      overflowY: getComputedStyle(box).overflowY,
      height: box.clientHeight,
      scrollHeight: box.scrollHeight,
      tileHeight: Math.round(tile.getBoundingClientRect().height),
      count: rows.length,
      rowHeights: rows.map((r) => Math.round(r.getBoundingClientRect().height)),
      // How many are readable without scrolling — the thing the card is for.
      visible: rows.filter((r) => {
        const rect = r.getBoundingClientRect();
        return rect.top >= boxRect.top - 1 && rect.bottom <= boxRect.bottom + 1;
      }).length,
      // Nothing may spill past the card's own box.
      spill: Math.round(Math.max(0, boxRect.bottom - tile.getBoundingClientRect().bottom)),
      // Does any row's text overlap the row beneath it? That is what a squashed
      // list looks like, and it is invisible to a max-height assertion.
      overlaps: rows.filter((r, i) => {
        const next = rows[i + 1];
        if (!next) return false;
        return r.getBoundingClientRect().bottom > next.getBoundingClientRect().top + 0.5;
      }).length,
    };
  });

  check(!!scroller, 'the employees list is on the board');
  if (scroller) {
    const shortest = Math.min(...scroller.rowHeights);
    log(`      ${scroller.count} employees, ${scroller.visible} visible without scrolling; ` +
      `${shortest}px shortest row; box ${scroller.height}px over ${scroller.scrollHeight}px ` +
      `inside a ${scroller.tileHeight}px tile`);

    /*
     * The bug this exists for: a flex column with a max-height shrinks its
     * children (flex-shrink defaults to 1), so thirteen rows were squeezed
     * into six rows' worth of space — every name sitting on the line beneath
     * it — instead of scrolling. Asserting max-height and overflow-y passed
     * that build, which is why the row geometry is measured instead.
     */
    check(scroller.overlaps === 0, `no row overlaps the one below it (${scroller.overlaps})`);
    check(shortest >= 44, `every row keeps its full height (shortest ${shortest}px)`);
    check(scroller.spill === 0, `nothing spills past the card (${scroller.spill}px)`);

    if (scroller.count > 6) {
      check(/auto|scroll/.test(scroller.overflowY), 'the overflow scrolls rather than clipping');
      check(scroller.scrollHeight > scroller.height + 4,
        'with more employees than fit, there is something to scroll to');
      // The card is stretched to line up with its column, and that space is
      // meant to hold names — not sit empty under six of them.
      check(scroller.visible >= 6,
        `it fills the space it was given (${scroller.visible} shown of ${scroller.count})`);
      check(scroller.height >= scroller.tileHeight - 120,
        `the list reaches the bottom of the card (${scroller.height} in ${scroller.tileHeight})`);

      /*
       * A taller card must show more people, not the same six over a third of
       * empty space.
       *
       * Driven rather than waited for: the masonry stretches the bottom card
       * in each column so the columns end level, and whether *this* card is
       * the one stretched depends on what else is on the board. A fixture that
       * happens not to stretch it would quietly assert nothing, so the height
       * is set here and put back afterwards.
       */
      const stretched = await page.evaluate(() => {
        const tile = document.querySelector('[data-tile-id="employees"]');
        const body = tile.querySelector('.tma-portal-panel__body');
        const before = tile.style.height;
        tile.style.height = '760px';
        void tile.offsetHeight;

        const boxRect = body.getBoundingClientRect();
        const visible = Array.from(tile.querySelectorAll('.tma-portal-employee')).filter((r) => {
          const rect = r.getBoundingClientRect();
          return rect.top >= boxRect.top - 1 && rect.bottom <= boxRect.bottom + 1;
        }).length;

        tile.style.height = before;
        return { visible, bodyHeight: Math.round(boxRect.height) };
      });

      log(`      given a 760px card: body ${stretched.bodyHeight}px, ${stretched.visible} visible`);
      check(stretched.visible > scroller.visible,
        `a taller card shows more people (${scroller.visible} → ${stretched.visible})`);
      check(stretched.bodyHeight >= 640,
        `and the list takes the whole card, not a fixed six rows (${stretched.bodyHeight}px)`);
    }
  }

  step(5, 'Hovering a colleague offers message, voice and video');
  const rowSel = '[data-tile-id="employees"] .tma-portal-employee';
  const hoverRow = page.locator(rowSel).filter({ hasText: 'Bea Adams' }).first();

  const hidden = await page.evaluate((sel) => {
    const row = Array.from(document.querySelectorAll(sel))
      .find((r) => /Bea Adams/.test(r.textContent || ''));
    const acts = row?.querySelector('.tma-portal-employee__actions');
    return acts ? getComputedStyle(acts).visibility : null;
  }, rowSel);
  check(hidden === 'hidden', `the buttons are out of the way until hovered (${hidden})`);

  await hoverRow.hover();
  await page.waitForTimeout(250);

  const onHover = await page.evaluate((sel) => {
    const row = Array.from(document.querySelectorAll(sel))
      .find((r) => /Bea Adams/.test(r.textContent || ''));
    if (!row) return null;
    const acts = row.querySelector('.tma-portal-employee__actions');
    const badge = row.querySelector('.tma-portal-employee__badge');
    return {
      visibility: getComputedStyle(acts).visibility,
      keys: Array.from(row.querySelectorAll('[data-home-employee-action]'))
        .map((b) => b.getAttribute('data-home-employee-action')),
      // Each must be a real target, not a 0×0 box behind the badge.
      boxes: Array.from(row.querySelectorAll('[data-home-employee-action]'))
        .map((b) => Math.round(b.getBoundingClientRect().width)),
      badgeShown: badge ? getComputedStyle(badge).display !== 'none' : false,
      rowHeight: Math.round(row.getBoundingClientRect().height),
    };
  }, rowSel);

  check(onHover?.visibility === 'visible', 'they appear on hover');
  check(JSON.stringify(onHover?.keys) === JSON.stringify(['message', 'audio', 'video']),
    `all three, in order (${(onHover?.keys || []).join(', ')})`);
  check((onHover?.boxes || []).every((w) => w >= 24), `each is clickable (${(onHover?.boxes || []).join('/')}px)`);
  check(onHover?.badgeShown === false, 'and the status badge steps aside rather than crowding them');

  // A row that grows under the pointer scrolls the rest of the list away.
  const restHeight = scroller ? Math.min(...scroller.rowHeights) : 0;
  check(Math.abs((onHover?.rowHeight || 0) - restHeight) <= 2,
    `the row does not change height on hover (${restHeight} → ${onHover?.rowHeight})`);

  step(6, 'Your own row has nobody to call');
  const selfActions = await page.evaluate((sel) => {
    const row = Array.from(document.querySelectorAll(sel)).find((r) => /\(you\)/.test(r.textContent || ''));
    return row ? row.querySelectorAll('[data-home-employee-action]').length : -1;
  }, rowSel);
  check(selfActions === 0, `no actions on your own row (${selfActions})`);

  step(7, 'Message opens the conversation without ringing anybody');
  await hoverRow.hover();
  await page.waitForTimeout(150);
  await hoverRow.locator('[data-home-employee-action="message"]').click();
  await page.waitForTimeout(3000);
  const messaged = await page.evaluate(() => {
    const view = document.querySelector('.tma-dash__view[data-view="messages"]');
    return {
      open: !!view && !view.hidden,
      thread: !!document.querySelector('[data-messages-compose], .tma-dash__messages-chat'),
      calling: !!document.querySelector('.tma-call'),
    };
  });
  check(messaged.open && messaged.thread, 'the direct conversation is open');
  check(!messaged.calling, 'and nothing is ringing — that button only messages');

  await page.click('.tma-dash__nav-item[data-nav="dash-dashboard"]');
  await page.waitForTimeout(1500);
  await parkPointer();

  step(8, 'Video call opens Messages with that person and rings');
  await hoverRow.hover();
  await page.waitForTimeout(150);
  await hoverRow.locator('[data-home-employee-action="video"]').click();
  await page.waitForTimeout(3000);

  const landed = await page.evaluate(() => {
    const view = document.querySelector('.tma-dash__view[data-view="messages"]');
    const call = document.querySelector('.tma-call');
    return {
      open: !!view && !view.hidden,
      path: window.location.pathname,
      // A call needs a *conversation*; the board only knows a person. Reaching
      // this state proves the whole chain — direct thread resolved, then rung.
      calling: !!call,
      video: !!call && call.classList.contains('tma-call--video'),
    };
  });
  check(landed.open, `Messages is on screen (${landed.path})`);
  check(landed.calling, 'and the call actually started, not just the page opened');
  check(landed.video, 'as a video call, which is the button that was pressed');

  // Headless Chromium has no camera, so the call lands in its error state and
  // its scrim covers the whole shell. Hang up through the module rather than
  // clicking through an overlay whose layout depends on that failure.
  await page.evaluate(() => window.TMAMessagingCalls && window.TMAMessagingCalls.end());
  await page.waitForTimeout(600);

  await page.click('.tma-dash__nav-item[data-nav="dash-dashboard"]');
  await page.waitForTimeout(1500);
  await parkPointer();

  step(9, 'Stamp the live nodes, then leave the Dashboard');
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

  step(10, 'Come straight back — nothing blanks, nothing is rebuilt');
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

  step(11, 'The very same elements are still there');
  check(after.employees === 'employees', 'the Employees card is the same node, not a rebuild');
  check(after.defaults === 'defaults' || stamped.defaultCards === 0,
    'the Default Folders section is the same node');
  check(after.library === 'library', 'the Recent Files table is the same node');
  if (stamped.recentRows > 0) {
    check(after.recent === 'recent', 'the Recent Files tile is the same node');
  }
  check(after.defaultCards === stamped.defaultCards, 'and the folder count settled unchanged');

  step(12, 'Coming back inside the freshness window asks the server for nothing');
  log(`      ${calls.length} data request(s): ${calls.map((u) => new URL(u).pathname).join(', ') || 'none'}`);
  check(calls.length === 0,
    `a revisit seconds later re-fetches nothing (${calls.length} request(s))`);

  step(13, 'Asking for a refresh explicitly still refetches');
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
