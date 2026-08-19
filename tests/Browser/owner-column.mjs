import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';

// The File Library's Owner column, after it was given CBI's Assigned column's
// behaviour: stacked faces for everyone on the row, a hover card that says who
// a face is and offers a way to reach them, and a filter by owner.
//
// The card itself is public/js/person-card.js — lifted out of cbi.js so both
// pages draw the same component rather than two copies of it. This script
// checks BOTH pages, because the point of the extraction is that CBI kept
// working: a passing File Library and a broken CBI is the failure mode.
//
// Setup: the standard throwaway sqlite server (README) with two staff accounts,
// e2e@example.com and bea@example.com.
const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8901';
const EMAIL = process.env.TMA_STAFF_EMAIL || 'e2e@example.com';
const DB = process.env.TMA_DB;
const log = (...a) => console.log(...a);
const failures = [];
const errors = [];

function step(n, msg) { log(`\n[${n}] ${msg}`); }
function check(ok, msg) {
  log(`    ${ok ? '✓' : '✗'} ${msg}`);
  if (!ok) failures.push(msg);
}

function tinker(code) {
  return execFileSync('php', ['artisan', 'tinker', '--execute', code], {
    env: { ...process.env, DB_CONNECTION: 'sqlite', DB_DATABASE: DB, DB_URL: '', FILES_DISK: 'local' },
    encoding: 'utf8',
  });
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
page.on('console', (m) => {
  if (m.type() === 'error' && !/403|404|realtime|WebSocket/.test(m.text())) errors.push('console: ' + m.text());
});
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

async function restMouse() {
  await page.mouse.move(1250, 900);
  await page.waitForTimeout(300);
}

try {
  step(1, 'Seeding a folder shared with a second person');
  // Two people on one row is what the column exists to show; one face proves
  // nothing about stacking.
  tinker(`
    $me = App\\Models\\User::where('email','e2e@example.com')->firstOrFail();
    $bea = App\\Models\\User::where('email','bea@example.com')->firstOrFail();
    $f = App\\Models\\Folder::firstOrCreate(
      ['name' => 'Shared with Bea', 'owner_id' => $me->id],
      ['uuid' => (string) Str::uuid(), 'created_by' => $me->id]
    );
    App\\Models\\Share::updateOrCreate(
      ['item_type' => 'folder', 'item_id' => $f->id, 'kind' => 'user', 'target_user_id' => $bea->id],
      // token is NOT NULL even for a user share, which only link shares use.
      ['role' => 'editor', 'shared_by' => $me->id, 'uuid' => (string) Str::uuid(),
       'token' => Str::random(32), 'revoked_at' => null]
    );
    // A folder owned by somebody else, shared back, so the listing has two
    // owners in it — with one, the Owner filter correctly draws nothing.
    $theirs = App\\Models\\Folder::firstOrCreate(
      ['name' => 'Bea owns this', 'owner_id' => $bea->id],
      ['uuid' => (string) Str::uuid(), 'created_by' => $bea->id]
    );
    App\\Models\\Share::updateOrCreate(
      ['item_type' => 'folder', 'item_id' => $theirs->id, 'kind' => 'user', 'target_user_id' => $me->id],
      ['role' => 'editor', 'shared_by' => $bea->id, 'uuid' => (string) Str::uuid(),
       'token' => Str::random(32), 'revoked_at' => null]
    );
    // A name far longer than its column, so the clipping is actually exercised
    // rather than skipped for want of anything long enough.
    App\\Models\\Folder::firstOrCreate(
      ['name' => 'Q3 2026 Citizenship by Investment supporting documentation and correspondence bundle FINAL v7', 'owner_id' => $me->id],
      ['uuid' => (string) Str::uuid(), 'created_by' => $me->id]
    );
    echo 'seeded';
  `);
  log('    seeded a folder with two people on it, a second owner, and a very long name');

  step(2, 'Signing in');
  await page.goto(`${BASE}/auth/login`, { waitUntil: 'networkidle' });
  await page.click('text=Sign in with Email');
  await page.waitForSelector('input[name="email"]', { state: 'visible', timeout: 8000 });
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', 'password12345');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}),
    page.click('button[type="submit"]:visible'),
  ]);
  await page.waitForTimeout(600);
  if (page.url().includes('/auth/stay-signed-in')) {
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}),
      page.click('text=Yes, stay signed in'),
    ]);
  }

  step(3, 'The server sends people and an owner facet');
  const payload = await page.evaluate(async (base) => {
    const res = await fetch(`${base}/portal/files/`, { headers: { Accept: 'application/json' } });
    const body = await res.json();
    const shared = (body.folders || []).find((f) => f.name === 'Shared with Bea');
    return { owners: body.owners, shared, folderCount: (body.folders || []).length };
  }, BASE);

  check(Array.isArray(payload.owners) && payload.owners.length > 0,
    `the listing reports owners (${(payload.owners || []).length})`);
  check(payload.owners.every((o) => o.id && o.name && typeof o.n === 'number'),
    'each owner carries an id, a name and a count');
  check(!!payload.shared, 'the seeded folder is in the listing');
  check((payload.shared.people || []).length === 2,
    `the shared folder carries two people (${(payload.shared.people || []).length})`);
  check(payload.shared.people[0].roles.includes('Owner'), 'the owner is first and marked Owner');
  check(!!payload.shared.people[1].userId, 'the second person carries a userId, so the card can reach them');

  step(4, 'The Shared with column draws faces, owner first');
  // /folders/all, not /files — the sidebar's File Library entries are the page.
  await page.goto(`${BASE}/folders/all`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-files-row]', { timeout: 30000 });

  const sharedRow = page.locator('[data-files-row]', { hasText: 'Shared with Bea' }).first();
  check(await sharedRow.count() > 0, 'the shared folder has a row');

  const facePile = sharedRow.locator('.tma-people__faces');
  check(await facePile.count() > 0, 'the Owner cell renders a face pile');
  const faceCount = await sharedRow.locator('[data-tma-person]').count();
  check(faceCount === 2, `both people are drawn as faces (${faceCount})`);

  /*
   * One person is named; several are faces alone. A list of names in a cell is
   * a paragraph, where the faces are a glance — and hovering any of them says
   * who it is, so nothing is lost.
   */
  check(
    !(await sharedRow.locator('.tma-people__names').count()),
    'with two people it is faces alone, no list of names',
  );

  // Something only its owner can reach: one face, and the name written out.
  const soloRow = page.locator('[data-files-row]', { hasText: 'Q3 2026 Citizenship' }).first();
  if (await soloRow.count()) {
    check(await soloRow.locator('[data-tma-person]').count() === 1, 'a one-person row draws one face');
    check(
      (await soloRow.locator('.tma-people__names').textContent()).trim().length > 0,
      'and names them beside it',
    );
  } else {
    log('      (no single-person row in this database)');
  }

  // Owner first: the faces are drawn in the order the server sends them.
  const order = await sharedRow.locator('[data-tma-person]').evaluateAll((els) =>
    els.map((e) => JSON.parse(e.closest('[data-tma-people]').getAttribute('data-tma-people'))[
      Number(e.getAttribute('data-tma-person'))
    ].roles.join(',')));
  check(/Owner/.test(order[0] || ''), `the owner comes first (${order.join(' | ')})`);

  // The people are the whole of this column. The grant that covers everyone
  // else is its own column beside it — crowded into one cell it read as a mess.
  const headers = await page.locator('.tma-portal-files-table thead th').allTextContents();
  check(headers.some((h) => /Shared with/.test(h)), `there is a "Shared with" column (${headers.filter(Boolean).join(', ')})`);
  check(!headers.some((h) => h.trim() === 'Sharing'), 'there is no separate "Sharing" column');
  check(
    !(await sharedRow.locator('.tma-portal-cell--owner .tma-portal-chip').count()),
    'the grant does not sit inside the names cell',
  );

  step(4.5, 'A group grant is named rather than drawn as a crowd of faces');
  /*
   * Nothing in this library is shared person to person — the firm's documents
   * are granted to every member of staff at once by the folder they sit in. A
   * row of thirteen identical faces would misdescribe that, so it is a word.
   */
  const orgRow = page.locator('[data-files-row]', { hasText: 'Citizenship Applications' }).first();
  if (await orgRow.count()) {
    /*
     * The grant reaches every member of staff, and those are the people it is
     * shared with — so they are drawn, owner first, then administrators, then
     * everyone else. Four faces and a "+N", which counts up to the real total
     * rather than to however many the server happened to send.
     */
    const faceCount = await orgRow.locator('[data-tma-person]').count();
    check(faceCount > 1, `it draws the staff it is shared with (${faceCount} faces)`);
    check(faceCount <= 4, 'capped at four');

    const first = await orgRow.locator('[data-tma-person]').first().evaluate((e) =>
      JSON.parse(e.closest('[data-tma-people]').getAttribute('data-tma-people'))[0].roles.join(','));
    check(/Owner/.test(first), `the owner is the first face (${first})`);

    const more = await orgRow.locator('.tma-people__face--more').textContent().catch(() => '');
    const ownerCell = orgRow.locator('.tma-portal-cell--owner');
    const totalAttr = await ownerCell.locator('[data-tma-people]').getAttribute('data-tma-people').catch(() => null);
    const total = totalAttr ? JSON.parse(totalAttr).length : faceCount;
    if (total > 4) {
      check(/^\+\d+$/.test(more), `a fifth circle counts the rest ("${more}")`);
      check(Number(more.slice(1)) === total - 4, `and counts up to everyone (${more} of ${total})`);
    }
  } else {
    log('      (no all-staff folder in this database)');
  }

  step(5, 'Hovering a face opens the person card');
  await restMouse();
  await sharedRow.locator('[data-tma-person]').first().hover();
  await page.waitForSelector('.tma-person-card[data-open]', { timeout: 8000 });

  const card = page.locator('.tma-person-card');
  const cardText = (await card.textContent()).trim();
  check(/Owner/.test(cardText), `the card names the role held here ("${cardText.slice(0, 60)}")`);
  check(await card.locator('[data-tma-person-action="message"]').count() > 0, 'it offers Message');
  check(await card.locator('[data-tma-person-action="call"]').count() > 0, 'it offers Call');
  check(await card.locator('[data-tma-person-action="video"]').count() > 0, 'it offers Video');
  check(
    !(await card.locator('[data-tma-person-action="message"]').isDisabled()),
    'and they are live for somebody with a portal account',
  );

  // The card has to survive the pointer travelling onto it, or its own buttons
  // are unclickable.
  await card.hover();
  await page.waitForTimeout(400);
  check(await card.getAttribute('data-open') === 'true', 'the card survives the pointer moving onto it');

  step(6, 'Escape closes it');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  check(await card.getAttribute('data-open') === null, 'Escape dismisses the card');

  step(7, 'Filtering by owner');
  await restMouse();
  const ownerMenu = page.locator('[data-files-owner-menu]');
  const hasMenu = await ownerMenu.count() > 0;
  check(hasMenu, 'the Owner filter is on the toolbar');

  if (hasMenu) {
    const label = (await ownerMenu.textContent()).trim();
    check(/All owners/.test(label), `it starts on "All owners" (got "${label}")`);

    await ownerMenu.click();
    await page.waitForTimeout(500);
    const options = await page.locator('[data-files-owner-menu] [role="menuitem"], [data-files-owner-menu] button').allTextContents();
    check(options.some((o) => /\(\d+\)/.test(o)), `owners are offered with a count each (${options.length} options)`);

    const target = page.locator('[data-files-owner-menu] [role="menuitem"], [data-files-owner-menu] button')
      .filter({ hasText: /\(\d+\)/ }).first();
    const chosen = (await target.textContent()).trim();
    await target.click();
    await page.waitForTimeout(1200);

    const applied = (await ownerMenu.textContent()).trim();
    check(applied.includes(chosen.split(' (')[0]), `the control reports what is applied ("${applied}")`);
    check(await page.locator('[data-files-row]').count() > 0, 'the listing still has rows after filtering');
  }

  step(8, 'The columns do not move with the length of a name');
  /*
   * The table used to size itself to its content, so one long filename widened
   * the Name column and shoved Owner and Modified rightwards — the
   * columns landed somewhere different in every folder.
   */
  const cols = await page.evaluate(() => {
    const table = document.querySelector('.tma-portal-files-table');
    if (!table) return null;
    const link = [...table.querySelectorAll('.tma-portal-file-link')]
      .sort((a, b) => b.textContent.length - a.textContent.length)[0];
    return {
      layout: getComputedStyle(table).tableLayout,
      headerCells: table.querySelectorAll('thead th').length,
      bodyCells: table.querySelector('tbody tr').children.length,
      longestName: link ? link.textContent.length : 0,
      clipped: link ? link.scrollWidth > link.clientWidth + 1 : false,
      ellipsis: link ? getComputedStyle(link).textOverflow : '',
      titled: link ? !!link.getAttribute('title') : false,
      bodyScrollsSideways: document.body.scrollWidth > document.body.clientWidth,
      nameWidth: Math.round(table.querySelector('th.tma-portal-cell--name').getBoundingClientRect().width),
      // The row menu is a 28px button; it used to sit in a 32px cell carrying
      // 12px of side padding, so its dots were sliced off at the right.
      menuFits: (() => {
        const btn = table.querySelector('.tma-portal-row-menu');
        if (!btn) return true;
        const cell = btn.closest('td').getBoundingClientRect();
        const b = btn.getBoundingClientRect();
        return b.right <= cell.right + 0.5 && b.left >= cell.left - 0.5;
      })(),
    };
  });

  check(cols && cols.layout === 'fixed', `the table lays out fixed (${cols && cols.layout})`);
  check(
    cols && cols.headerCells === cols.bodyCells,
    `every body cell has a header cell to take its width from (${cols && cols.headerCells} vs ${cols && cols.bodyCells})`,
  );
  check(!cols.bodyScrollsSideways, 'and the page body still does not scroll sideways');
  check(cols.nameWidth <= 360, `the Name column is a flat width, not the leftovers (${cols.nameWidth}px)`);
  check(cols.menuFits, 'the row-menu dots are not clipped by their cell');

  if (cols.longestName > 40) {
    check(cols.clipped, `the long name is clipped rather than widening its column (${cols.longestName} chars)`);
    check(cols.ellipsis === 'ellipsis', 'it ends in dots');
    check(cols.titled, 'and the whole name is still readable from its title');
  } else {
    log(`      (no name long enough to clip — ${cols.longestName} chars)`);
  }

  step(9, 'CBI still works — the same component, not a copy');
  await page.goto(`${BASE}/cbi`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);

  // A fresh database has no CBI applications, so the table may legitimately be
  // empty. What must hold either way is that the page rendered without the
  // errors a half-finished extraction would throw.
  const cbiBroke = errors.filter((e) => /TMAPersonCard|showPersonCard|peopleOnCase|is not defined/.test(e));
  check(cbiBroke.length === 0, `CBI raised no missing-symbol errors (${cbiBroke.length})`);
  check(
    await page.locator('.cbi-tabs, [data-cbi-body], .tma-portal-head').count() > 0,
    'the CBI page rendered',
  );

  const cbiFaces = await page.locator('[data-cbi-body] [data-tma-person]').count();
  log(`      (CBI drew ${cbiFaces} face(s) — 0 is fine on a fresh database)`);

  await page.screenshot({ path: 'tests/Browser/owner-column.png', fullPage: false });
} catch (e) {
  failures.push(`threw: ${e.message}`);
  await page.screenshot({ path: 'tests/Browser/owner-column-error.png' }).catch(() => {});
} finally {
  await browser.close();
}

log('\n' + '─'.repeat(56));
if (errors.length) {
  log('Console/page errors:');
  errors.forEach((e) => log('  ! ' + e));
}
if (failures.length) {
  log(`✗ ${failures.length} check(s) failed`);
  failures.forEach((f) => log('  ✗ ' + f));
  process.exit(1);
}
log('✓ all checks passed');
