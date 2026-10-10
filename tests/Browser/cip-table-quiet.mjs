import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/*
 * The applications table catches up without being redrawn.
 *
 * `cip-live.mjs` pins that a signal reaches the table and the right numbers
 * arrive. This pins how they arrive, which is the half a reader notices: every
 * signal used to drop the rows, paint the loading skeleton, and draw the whole
 * table again a moment later. The signals come from the whole firm's work, so
 * from the chair it was a table that refreshed at random and lost your place.
 *
 * So the assertions are about nodes, not text. Each row is stamped before the
 * signal and looked for afterwards: a table that was rebuilt shows the same
 * words on different elements, and passes any check that only reads it. The
 * listing is slowed down so the wait between the signal and the answer is long
 * enough to be watched.
 *
 * Needs an administrator and a dozen or so applications with a main applicant
 * each (enough to scroll), served with FEATURE_CIP=true and MAIL_MAILER=log.
 */
const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8899';
const DB = process.env.TMA_DB;
const LOG = process.env.TMA_LOG || 'storage/logs/laravel.log';
const EMAIL = process.env.TMA_STAFF_EMAIL || 'e2e@example.com';
const PASSWORD = process.env.TMA_STAFF_PASSWORD || 'password12345';

const failures = [];
const check = (ok, msg) => { console.log(`    ${ok ? '✓' : '✗'} ${msg}`); if (!ok) failures.push(msg); };
const step = (n, msg) => console.log(`\n[${n}] ${msg}`);

/** A colleague's write, made outside this browser entirely. */
function colleague(php) {
  return execFileSync('php', ['artisan', 'tinker', '--execute', php], {
    env: { ...process.env, DB_CONNECTION: 'sqlite', DB_DATABASE: DB, DB_URL: '', FEATURE_CIP: 'true', BROADCAST_CONNECTION: 'log' },
    encoding: 'utf8',
  }).trim().split('\n').pop().trim();
}

/* The emailed sign-in code: the big letter-spaced cell, not the CSS colours. */
function loginCode() {
  const log = readFileSync(LOG, 'utf8');
  const all = [...log.matchAll(/letter-spacing:[^>]*>\s*(\d{6})\s*</g)];
  return all.length ? all[all.length - 1][1] : null;
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1500, height: 620 } });
// The legal-terms prompt is for a person; a fresh browser would stop on it.
await ctx.addInitScript(() => { try { localStorage.setItem('tma.legalAccepted', '1'); } catch (e) { /* asked instead */ } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e).slice(0, 200)));

try {
  await page.goto(`${BASE}/auth/login`, { waitUntil: 'domcontentloaded' });
  await page.click('text=Sign in with Email');
  await page.waitForSelector('input[name="email"]', { state: 'visible' });
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}), page.click('button[type="submit"]:visible')]);
  await page.waitForTimeout(700);
  if (page.url().includes('/auth/login-code')) {
    await page.waitForTimeout(900);
    const code = loginCode();
    if (!code) throw new Error(`no sign-in code in ${LOG}`);
    await page.locator('.tma-auth__otp-digit').first().click();
    await page.keyboard.type(code, { delay: 40 });
    await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}), page.click('button[type="submit"]:visible')]);
    await page.waitForTimeout(900);
  }
  if (page.url().includes('/auth/stay-signed-in')) {
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}),
      page.click('form:has(input[name="stay"][value="yes"]) button[type="submit"]'),
    ]);
    await page.waitForTimeout(700);
  }

  step(1, 'The table is up, and long enough to scroll');
  await page.goto(`${BASE}/clients`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.tma-cip-table tbody tr[data-cip-open]', { timeout: 60000 });
  // The other lanes are fetched behind the first paint; let them land so the
  // only listing requests counted below are the ones a signal causes.
  await page.waitForTimeout(3000);

  const ROWS = await page.locator('.tma-cip-table tbody tr[data-cip-open]').count();
  check(ROWS >= 10, `${ROWS} applications listed`);

  /*
   * Stamp every row, scroll the reader down the list, and start watching for
   * the two things a rebuild leaves behind: skeleton bars in the table or in
   * the count beside it, and a moment when the rows were not there.
   */
  await page.evaluate(() => {
    document.querySelectorAll('.tma-cip-table tbody tr[data-cip-open]').forEach((tr, i) => {
      tr.__stamp = tr.getAttribute('data-cip-app');
    });
    document.querySelector('.tma-cip-table tbody').__stamp = 'tbody';

    const scroller = [...document.querySelectorAll('[data-clients-scroll], .tma-dash__main, .tma-dash__content')]
      .find(el => el.scrollHeight > el.clientHeight + 40) || document.scrollingElement;
    scroller.scrollTop = 180;
    window.__scroller = scroller;

    window.__seen = { skeleton: 0, countSkeleton: 0, fewest: Infinity, error: 0 };
    const look = () => {
      const table = document.querySelector('.tma-cip-table');
      if (table && table.querySelector('.tma-skeleton')) window.__seen.skeleton++;
      const count = document.querySelector('.tma-dash__toolbar-count');
      if (count && count.querySelector('.tma-skeleton')) window.__seen.countSkeleton++;
      if (document.body.innerText.includes('Could not load applications')) window.__seen.error++;
      const n = document.querySelectorAll('.tma-cip-table tbody tr[data-cip-open]').length;
      if (n < window.__seen.fewest) window.__seen.fewest = n;
    };
    new MutationObserver(look).observe(document.body, { childList: true, subtree: true, characterData: true });
    window.__look = look;
  });
  const scrolledTo = await page.evaluate(() => window.__scroller.scrollTop);
  check(scrolledTo > 0, `the reader is ${scrolledTo}px down the list`);

  // Slow enough to watch. Without this the gap is a frame on a local server
  // and a table that blanked would rarely be caught in the act.
  let listings = 0;
  let failNext = false;
  await page.route('**/portal/cip/applications?**', async route => {
    listings++;
    if (failNext) { failNext = false; await new Promise(r => setTimeout(r, 300)); return route.abort(); }
    await new Promise(r => setTimeout(r, 900));
    return route.continue();
  });

  const state = () => page.evaluate(() => {
    window.__look();
    const rows = [...document.querySelectorAll('.tma-cip-table tbody tr[data-cip-open]')];
    return {
      rows: rows.length,
      kept: rows.filter(tr => tr.__stamp && tr.__stamp === tr.getAttribute('data-cip-app')).length,
      tbody: document.querySelector('.tma-cip-table tbody')?.__stamp === 'tbody',
      scroll: window.__scroller.scrollTop,
      count: document.querySelector('.tma-dash__toolbar-count')?.innerText.replace(/\s+/g, ' ').trim() || '',
      top: rows[0]?.innerText.replace(/\s+/g, ' ').trim() || '',
      seen: { ...window.__seen },
    };
  });

  step(2, 'A signal with nothing changed leaves the table exactly as it was');
  const before = await state();
  await page.evaluate(() => window.TMALive.flush('cip'));
  await page.waitForTimeout(350);
  const during = await state();
  check(during.rows === ROWS, `the rows are still up while the answer is on its way (${during.rows})`);
  check(/\d/.test(during.count), `and so is the count (${during.count || 'gone'})`);
  await page.waitForTimeout(2600);
  const quiet = await state();

  check(listings >= 1, `the table was re-read (${listings} listing request${listings === 1 ? '' : 's'})`);
  check(quiet.seen.skeleton === 0, 'no loading skeleton was ever painted in the table');
  check(quiet.seen.countSkeleton === 0, 'nor beside the count');
  check(quiet.seen.fewest === ROWS, `the table never emptied (fewest rows on screen: ${quiet.seen.fewest})`);
  check(quiet.kept === ROWS && quiet.tbody, `every row is the same element it was (${quiet.kept}/${ROWS})`);
  check(quiet.scroll === scrolledTo, `the reader is where they were (${scrolledTo}px → ${quiet.scroll}px)`);
  check(quiet.count === before.count, `the count reads the same (${quiet.count})`);

  step(3, 'A colleague files one and moves another; only those two lines change');
  // Named per run, so a second run against the same database still has
  // exactly one of them to find.
  const NEWCOMER = 'Newcomer' + String(Date.now()).slice(-6);
  const SUBJECT = await page.evaluate(() =>
    document.querySelectorAll('.tma-cip-table tbody tr[data-cip-open]')[3].getAttribute('data-cip-app'));
  colleague(`
    $admin = App\\Models\\User::where('email','${EMAIL}')->first();
    $rita = App\\Models\\User::where('email','rita@example.com')->first();
    $moved = App\\Models\\CipApplication::where('uuid','${SUBJECT}')->firstOrFail();
    App\\Support\\Cip\\Assignments::assign($moved, $rita, $admin);
    $new = App\\Support\\Cip\\Applications::create(App\\Models\\CipProvider::first(), $admin);
    App\\Models\\CipPerson::create(['application_id' => $new->id, 'role' => 'main_applicant', 'first_name' => 'Zed', 'last_name' => '${NEWCOMER}']);
    echo 'done';`);

  await page.evaluate(() => { window.__seen.fewest = Infinity; });
  await page.evaluate(() => window.TMALive.flush('cip'));
  await page.waitForTimeout(3600);
  const moved = await state();

  check(moved.rows === ROWS + 1, `the new application is listed (${ROWS} → ${moved.rows})`);
  const arrival = await page.evaluate(name => {
    const tr = [...document.querySelectorAll('.tma-cip-table tbody tr[data-cip-open]')]
      // The table sets names in capitals, and innerText reads what is drawn.
      .find(row => row.innerText.toLowerCase().includes(name.toLowerCase()));
    return { found: !!tr, fresh: !!tr && !tr.__stamp };
  }, NEWCOMER);
  check(arrival.found && arrival.fresh, 'on a row of its own, the only new element in the table');
  check(moved.kept === ROWS, `and every row that was already there is still the same element (${moved.kept}/${ROWS})`);
  const subject = await page.evaluate(id => {
    const tr = document.querySelector(`.tma-cip-table tbody tr[data-cip-app="${id}"]`);
    return { text: tr?.innerText.replace(/\s+/g, ' ').trim() || '', same: !!tr && tr.__stamp === id };
  }, SUBJECT);
  check(subject.text.includes('Rita Officer'), 'the moved file names its officer');
  check(subject.same, 'on the row it already had');
  check(moved.seen.skeleton === 0 && moved.seen.countSkeleton === 0, 'still no skeleton');
  check(moved.seen.fewest >= ROWS, `and the table never emptied (fewest: ${moved.seen.fewest})`);
  check(moved.count.includes(String(ROWS + 1)), `the count caught up (${moved.count})`);

  step(4, 'An unread message does the same');
  await page.evaluate(() => { window.__seen.fewest = Infinity; });
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('tma-cip-unread')));
  await page.waitForTimeout(3200);
  const unread = await state();
  check(unread.seen.skeleton === 0 && unread.seen.fewest === ROWS + 1,
    `no skeleton, no empty table (fewest: ${unread.seen.fewest})`);
  check(unread.kept === ROWS, `the same elements again (${unread.kept}/${ROWS})`);

  step(5, 'A background read that fails keeps the table');
  failNext = true;
  await page.evaluate(() => window.TMALive.flush('cip'));
  await page.waitForTimeout(2500);
  const failed = await state();
  check(failed.seen.error === 0, 'no "Could not load applications" over a working list');
  check(failed.rows === ROWS + 1, `the rows stayed (${failed.rows})`);

  step(6, 'A view the reader asks for still loads as one');
  await page.evaluate(() => { window.__seen.skeleton = 0; });
  await page.unroute('**/portal/cip/applications?**');
  await page.route('**/portal/cip/applications?**', async route => {
    await new Promise(r => setTimeout(r, 700));
    return route.continue();
  });
  // A search is a different list: it must not be painted with these rows.
  const search = page.locator('[data-clients-search]:visible').first();
  if (await search.count()) {
    await search.click();
    await page.keyboard.type(NEWCOMER, { delay: 30 });
    await page.waitForTimeout(450);
    const midSearch = await state();
    await page.waitForTimeout(3000);
    const found = await state();
    check(midSearch.seen.skeleton > 0 || midSearch.rows <= 1,
      'the full list is not left up under a search it does not answer');
    check(found.rows === 1 && found.top.toLowerCase().includes(NEWCOMER.toLowerCase()),
      `the search lands on its one result (${found.rows})`);
  } else {
    check(false, 'no search field found to test a new view');
  }

  step(7, 'Nothing broke');
  check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);

  await page.screenshot({ path: 'tests/Browser/cip-table-quiet.png', fullPage: false });
} catch (e) {
  failures.push(String(e).slice(0, 300));
  await page.screenshot({ path: 'tests/Browser/cip-table-quiet.png' }).catch(() => {});
} finally {
  console.log(failures.length ? `\nFAILED (${failures.length}):` : '\nPASSED');
  failures.forEach(f => console.log('   ', f));
  await browser.close();
  process.exit(failures.length ? 1 : 0);
}
