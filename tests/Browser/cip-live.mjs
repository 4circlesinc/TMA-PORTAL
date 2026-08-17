import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';

/*
 * Live updates in the CIP module (§8's table, §9's chips, and the file open
 * beside them).
 *
 * Every CIP write raises a signal, and until this suite existed nothing in the
 * browser listened for one: the resource was named on both sides and the eight
 * endpoints that fire it reached a registry with no entry in it. What is
 * pinned here is the half past the socket — the refresh a delivered signal
 * runs — because that is the half this module owns. The socket itself is
 * shared with every other resource and proven by them.
 *
 * The writes are made by shelling out rather than through a second browser, so
 * they are unambiguously from somewhere else: no fetch this page made, no
 * cache it holds, and no chance of the tab having updated itself.
 *
 * Needs an administrator, a Reviewing Officer named rita@example.com, and at
 * least one application on a client. The subject is whichever one the table
 * puts first, so it runs against a harness of any size.
 */
const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8899';
const DB = process.env.TMA_DB;
const EMAIL = process.env.TMA_STAFF_EMAIL || 'e2e@example.com';
const PASSWORD = process.env.TMA_STAFF_PASSWORD || 'password12345';

const failures = [];
const check = (ok, msg) => { console.log(`    ${ok ? '✓' : '✗'} ${msg}`); if (!ok) failures.push(msg); };
const step = (n, msg) => console.log(`\n[${n}] ${msg}`);

/** A colleague's write, made outside this browser entirely. */
function colleague(php) {
  return execFileSync('php', ['artisan', 'tinker', '--execute', php], {
    env: { ...process.env, DB_CONNECTION: 'sqlite', DB_DATABASE: DB, DB_URL: '', FEATURE_CIP: 'true' },
    encoding: 'utf8',
  }).trim().split('\n').pop().trim();
}

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
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
  if (page.url().includes('/auth/stay-signed-in')) {
    await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}), page.click('text=Yes, stay signed in')]);
    await page.waitForTimeout(700);
  }

  step(1, 'The module is watching its resource');
  await page.goto(`${BASE}/clients`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.tma-cip-table tbody tr[data-cip-open]', { timeout: 60000 });
  await page.waitForTimeout(2500);

  check(await page.evaluate(() => !!(window.TMALive && window.TMALive.RESOURCES.CIP === 'cip')),
    'the browser knows the resource the server fires');

  /*
   * The subject is whichever application the table puts first, addressed by
   * its number rather than by being first in the database — the two are not
   * the same order, and a suite that assumed they were would move one
   * application and then assert about a different one.
   */
  const NUM = await page.evaluate(() =>
    document.querySelector('.tma-cip-table tbody tr td:first-child')?.innerText.trim().split(/\s+/)[0] || '');
  check(/^[A-Z]{2,8}\d{2}-\d{5}$/.test(NUM), `the top row is ${NUM}`);
  // Either column, because the row shows whichever number the file has (§7):
  // ours until the Unit issues theirs, and theirs from then on.
  const app = `App\\Models\\CipApplication::where('internal_number', '${NUM}')`
    + `->orWhere('cip_number', '${NUM}')->firstOrFail()`;

  // The run moves it on twice, so it starts by putting it back.
  colleague(`
    $a = ${app};
    $a->forceFill(['status' => 'new', 'assigned_officer_id' => null])->save();
    App\\Models\\CipApplicationAssignment::where('application_id', $a->id)->delete();
    echo 'reset';`);
  await page.evaluate(() => window.TMALive.flush('cip'));
  await page.waitForTimeout(2500);

  // Counted so a refresh that fetched nothing cannot pass by luck, and so the
  // one that runs while nothing is open stays free.
  await page.evaluate(() => {
    window.__cipReqs = 0;
    const f = window.fetch;
    window.fetch = function (u) {
      if (String(u).includes('/portal/cip/')) window.__cipReqs++;
      return f.apply(this, arguments);
    };
  });

  const table = () => page.evaluate(() => ({
    // label -> count, so the assertions can be about what moved rather than
    // about this harness holding exactly one application.
    chips: Object.fromEntries([...document.querySelectorAll('[data-cip-bucket]')]
      .filter(x => x.dataset.cipBucket)
      .map(x => [x.querySelector('.tma-dash__cip-bucket-label')?.innerText.trim(),
        Number(x.querySelector('.tma-dash__cip-bucket-count')?.innerText.trim())])),
    row: document.querySelector('.tma-cip-table tbody tr')?.innerText.replace(/\s+/g, ' ').trim() || '',
    reqs: window.__cipReqs || 0,
  }));

  step(2, 'A colleague assigns it; the table and the chips follow');
  const before = await table();
  check(before.row.startsWith(NUM) && before.row.includes('New'), `${NUM} starts in New`);
  check(before.row.includes('Unassigned'), 'and nobody holds it');

  colleague(`
    $a = ${app};
    $rita = App\\Models\\User::where('email','rita@example.com')->first();
    $admin = App\\Models\\User::where('email','${EMAIL}')->first();
    App\\Support\\Cip\\Assignments::assign($a, $rita, $admin);
    echo $a->refresh()->status;`);

  // flush() is what the socket calls when the signal lands. Deliberately not a
  // reload: the whole point is the screen catching up without one.
  await page.evaluate(() => window.TMALive.flush('cip'));
  await page.waitForTimeout(2500);

  const after = await table();
  check(after.chips['New Applications'] === before.chips['New Applications'] - 1
    && after.chips['Review Applications'] === before.chips['Review Applications'] + 1,
    `the counts moved without a reload (New ${before.chips['New Applications']}→${after.chips['New Applications']},`
    + ` Review ${before.chips['Review Applications']}→${after.chips['Review Applications']})`);
  check(after.row.includes('Review application'), 'the row says the new status');
  check(after.row.includes('Rita Officer'), 'and names the officer who now holds it');
  check(after.reqs === 2, `one read each for the table and the chips (${after.reqs})`);

  step(3, 'The open file follows too, without blanking');
  await page.click('.tma-cip-table tbody tr[data-cip-open] td:first-child');
  await page.waitForTimeout(3000);
  await page.click('[data-clients-tab="activity"]');
  await page.waitForTimeout(1500);

  const read = () => page.evaluate(() => ({
    head: document.querySelector('.tma-dash__clients-profile-head')?.innerText.replace(/\s+/g, ' ').trim() || '',
    top: document.querySelector('.tma-dash__cip-activity li')?.innerText.replace(/\s+/g, ' ').trim() || '',
    rows: document.querySelectorAll('.tma-dash__cip-activity li').length,
    tab: document.querySelector('[data-clients-tab="activity"]')?.getAttribute('aria-selected'),
    tabs: document.querySelectorAll('[data-clients-tab]').length,
  }));

  const opened = await read();
  check(opened.head.includes('Review application'), 'the header shows where it is');
  check(opened.rows > 0, `the history is there (${opened.rows} entries)`);

  colleague(`
    $a = ${app};
    $rita = App\\Models\\User::where('email','rita@example.com')->first();
    App\\Support\\Cip\\Engine::apply($a, 'assessment_feedback', $rita);
    echo $a->refresh()->status;`);

  await page.evaluate(() => window.TMALive.flush('cip'));
  await page.waitForTimeout(3000);

  const settled = await read();
  check(settled.head.includes('Assessment feedback'), `the header caught up (${settled.head})`);
  check(settled.rows === opened.rows + 1, `the history gained the entry (${opened.rows} → ${settled.rows})`);
  check(/Rita Officer moved it from Review application to Assessment feedback/.test(settled.top),
    'and it reads as a sentence at the top');

  /*
   * The two that would give the refresh away as a re-open rather than an
   * update. The application decides which tabs this profile has, so dropping
   * the held record to refetch it takes them off the screen and puts them
   * back; and a reader who was on Activity would be returned to the first tab.
   */
  check(settled.tab === 'true', 'the reader is still on the tab they were reading');
  check(settled.tabs === opened.tabs, `the tabs never went away (${opened.tabs} → ${settled.tabs})`);

  step(4, 'Nothing broke');
  check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);

  await page.screenshot({ path: 'tests/Browser/cip-live.png', fullPage: false });
} catch (e) {
  failures.push(String(e).slice(0, 300));
  await page.screenshot({ path: 'tests/Browser/cip-live.png' }).catch(() => {});
} finally {
  console.log(failures.length ? `\nFAILED (${failures.length}):` : '\nPASSED');
  failures.forEach(f => console.log('   ', f));
  await browser.close();
  process.exit(failures.length ? 1 : 0);
}
