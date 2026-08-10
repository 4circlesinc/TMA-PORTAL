import { chromium } from 'playwright';

// What the Client hub does while it is loading, when it has nothing to show,
// and when the request fails.
//
// Written after the directory was found to be shipping every client's full
// contact profile on every page load: 9.6 MB of JSON and a 127 MB PHP memory
// peak for eleven thousand clients, which is what was exhausting the
// container. When that request timed out the page caught the error, hydrated
// an empty list from it, and rendered "No clients found" — so staff were told
// the firm had no clients whenever the directory failed to load.
//
// The checks below are the three states that were previously one: loading,
// genuinely empty, and failed.
//
// Setup: the standard throwaway sqlite server (README) seeded with a large
// client directory, exactly as clients-table.mjs wants it. The same two
// harness rules apply — scope selectors to the clients table, and park the
// pointer away from the hover-overlay sidebar.
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

const CLIENT_ROW = '.tma-dash__ctable--clients .tma-dash__ctr--body';
const SKELETON_ROW = '.tma-dash__ctable--clients .tma-dash__ctr--skeleton';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
page.on('console', (m) => {
  if (m.type() === 'error' && !/403|404|realtime/.test(m.text())) errors.push('console: ' + m.text());
});
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

async function restMouse() {
  await page.mouse.move(1250, 640);
  await page.waitForTimeout(400);
}

async function signIn() {
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
}

try {
  step(1, 'Signing in');
  await signIn();

  step(2, 'The listing is lean — no profile blobs on the wire');
  const listing = await page.evaluate(async (base) => {
    const started = performance.now();
    const res = await fetch(`${base}/portal/clients`, { headers: { Accept: 'application/json' } });
    const text = await res.text();
    const body = JSON.parse(text);
    return {
      ms: Math.round(performance.now() - started),
      bytes: text.length,
      count: body.clients.length,
      first: body.clients[0],
      anyProfile: body.clients.some((c) => 'profile' in c),
    };
  }, BASE);

  check(listing.count > 1000, `the whole directory is returned (${listing.count.toLocaleString()} clients)`);
  check(!listing.anyProfile, 'not one record carries a profile blob');
  check(listing.first && 'contact' in listing.first, 'each record carries the Contact column value instead');
  check(
    listing.bytes / listing.count < 400,
    `the payload stays lean per record (${Math.round(listing.bytes / listing.count)} bytes each, ` +
    `${(listing.bytes / 1048576).toFixed(2)} MB total)`,
  );
  log(`      → ${(listing.bytes / 1048576).toFixed(2)} MB in ${listing.ms}ms`);

  step(3, 'A skeleton holds the layout while the directory loads');
  // Hold the listing open long enough to see what the page draws in the gap.
  // The delay outlives the unroute below, so the continue is guarded: a
  // handler still sleeping when its route is lifted throws otherwise.
  await page.route('**/portal/clients', async (route) => {
    await new Promise((r) => setTimeout(r, 2500));
    await route.continue().catch(() => {});
  });
  await page.goto(`${BASE}/clients`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(SKELETON_ROW, { timeout: 15000 });
  const skeletonCount = await page.locator(SKELETON_ROW).count();
  check(skeletonCount > 4, `skeleton rows are drawn while waiting (${skeletonCount})`);

  const shimmer = await page.locator(`${SKELETON_ROW} .tma-skeleton`).first();
  check(await shimmer.isVisible(), 'they use the shared .tma-skeleton system');

  // The count must not claim a total it has not been told yet.
  const loadingCount = (await page.locator('[data-clients-count]').textContent()).trim();
  check(!/^0\b/.test(loadingCount), `the count does not report "0 clients" while loading ("${loadingCount}")`);

  // And the table's own chrome is already there, so nothing jumps on arrival.
  const headBefore = await page.locator('.tma-dash__ctable--clients .tma-dash__ctr--head').boundingBox();
  await page.waitForSelector(CLIENT_ROW, { timeout: 60000 });
  await page.unroute('**/portal/clients');
  const headAfter = await page.locator('.tma-dash__ctable--clients .tma-dash__ctr--head').boundingBox();
  check(
    Math.abs(headBefore.y - headAfter.y) < 2,
    `the table header does not move when the data lands (${headBefore.y} → ${headAfter.y})`,
  );

  step(4, 'A failed load says so, and offers a retry');
  await page.route('**/portal/clients', (route) => route.fulfill({ status: 500, body: 'boom' }));
  await page.goto(`${BASE}/clients`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.tma-dash__clients-load-error', { timeout: 20000 });

  const errorText = (await page.locator('.tma-dash__clients-load-error').textContent()).trim();
  check(/Couldn[’']t load your clients/.test(errorText), 'it reports a failure to load');
  check(
    !/No clients found/i.test(errorText),
    'it does NOT claim the firm has no clients — the bug this was written for',
  );
  const errorArt = page.locator('.tma-dash__clients-load-error-art');
  check(await errorArt.isVisible(), 'the failure carries an illustration');
  check(await page.locator('[data-clients-retry]').isVisible(), 'and a Try again button');

  // Retrying with the route lifted has to actually recover.
  await page.unroute('**/portal/clients');
  await restMouse();
  await page.click('[data-clients-retry]');
  await page.waitForSelector(CLIENT_ROW, { timeout: 60000 });
  check(await page.locator(CLIENT_ROW).count() > 0, 'Try again loads the directory for real');

  step(5, 'Search reaches fields the browser no longer holds');
  // "Batsy" is a nickname. It is in no column and no longer in the browser —
  // only the database can answer this, which is the point of the endpoint.
  await restMouse();
  await page.fill('[data-clients-search]', 'Batsy');
  await page.waitForTimeout(1400);
  const nicknameRows = await page.locator(CLIENT_ROW).count();
  const nicknameText = nicknameRows ? await page.locator(CLIENT_ROW).first().textContent() : '';
  check(nicknameRows === 1, `a nickname held only in the profile matches (${nicknameRows} row)`);
  check(/Bruce Wayne/.test(nicknameText), 'and it is the right client');

  step(6, 'No matches is an empty state, not a failure');
  await page.fill('[data-clients-search]', 'zzzzqqqnobodyhere');
  await page.waitForTimeout(1400);
  const noData = page.locator('.tma-dash__ctable--clients .tma-no-data');
  check(await noData.isVisible(), 'the no-matches state renders');
  const illustration = noData.locator('.tma-no-data__illustration');
  check(await illustration.isVisible(), 'it carries an illustration');
  const illSrc = await illustration.getAttribute('src');
  check(/images\/illustrations\//.test(illSrc), `drawn from the shared illustration set (${illSrc})`);
  const noDataText = (await noData.textContent()).trim();
  check(/No matches/.test(noDataText), `it says what happened ("${noDataText.slice(0, 60)}")`);
  check(
    !(await page.locator('.tma-dash__ctable--clients [data-no-data-action="add"]').count()),
    'and it offers no "Add client" button, because adding one would not help',
  );

  await page.fill('[data-clients-search]', '');
  await page.waitForTimeout(900);

  step(7, 'Opening a client fetches its profile on demand');
  const detailRequests = [];
  page.on('request', (r) => {
    if (/\/portal\/clients\/[^/?]+$/.test(r.url())) detailRequests.push(r.url());
  });

  await restMouse();
  await page.fill('[data-clients-search]', 'Bruce Wayne');
  await page.waitForTimeout(1400);
  // The name cell specifically: the Referral column is a link to the referring
  // company, and it sits under the middle of the row.
  await page.locator(`${CLIENT_ROW} .tma-dash__cc--user`).first().click();
  await page.waitForSelector('.tma-dash__clients-profile', { timeout: 20000 });
  await page.waitForTimeout(1800);

  check(detailRequests.length > 0, `the profile is fetched when the client is opened (${detailRequests.length} request)`);

  const detail = page.locator('.tma-dash__clients-profile').first();
  const detailText = (await detail.textContent()).trim();
  check(/bruce@wayneent\.com/.test(detailText), 'the fetched profile is rendered (email is shown)');
  check(/Chief Executive/.test(detailText), 'including fields the listing never carried (job title)');
  check(
    !(await page.locator('.tma-dash__clients-profile-skeleton').count()),
    'and the profile skeleton has been replaced by the record',
  );

  step(8, 'A profile that fails to load is not drawn as an empty record');
  await page.route('**/portal/clients/*', (route) => {
    if (/\/portal\/clients\/[^/?]+$/.test(route.request().url())) {
      return route.fulfill({ status: 500, body: 'boom' });
    }
    return route.continue();
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.tma-dash__clients-profile-error', { timeout: 25000 });
  const profileError = (await page.locator('.tma-dash__clients-profile-error').textContent()).trim();
  check(profileError.length > 0, `the detail panel reports the failure ("${profileError.slice(0, 50)}")`);
  check(
    await page.locator('[data-clients-retry-profile]').isVisible(),
    'and offers to try that client again',
  );
  await page.unroute('**/portal/clients/*');

  step(9, 'A firm with no clients gets an illustrated empty state');
  // The only one of the three states that is genuinely "nothing here", and the
  // only one that should offer to add something.
  await page.route('**/portal/clients', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ clients: [], customFields: [] }),
    }));
  await page.goto(`${BASE}/clients`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.tma-dash__ctable--clients .tma-no-data', { timeout: 25000 });

  const empty = page.locator('.tma-dash__ctable--clients .tma-no-data');
  const emptyText = (await empty.textContent()).trim();
  check(/No clients yet/.test(emptyText), `it says the directory is empty ("${emptyText.slice(0, 40)}")`);
  check(
    !/Couldn[’']t load/.test(emptyText),
    'and does not confuse an empty directory with a failed one',
  );
  const emptyArt = empty.locator('.tma-no-data__illustration');
  check(await emptyArt.isVisible(), 'the empty state carries an illustration');
  const box = await emptyArt.boundingBox();
  check(box && box.width > 40, `the illustration is actually drawn (${Math.round(box?.width || 0)}px)`);
  check(
    await page.locator('.tma-dash__ctable--clients [data-no-data-action="add"]').isVisible(),
    'and here it does offer to add the first client',
  );

  await page.screenshot({ path: 'tests/Browser/clients-empty.png', fullPage: false });

  step(10, 'The Add client button in the empty state actually opens the form');
  await restMouse();
  await page.click('.tma-dash__ctable--clients [data-no-data-action="add"]');
  await page.waitForTimeout(1200);
  check(
    await page.locator('[data-clients-field="firstName"]').isVisible(),
    'the new-client form opens',
  );
  await page.unroute('**/portal/clients');

  await page.screenshot({ path: 'tests/Browser/clients-loading.png', fullPage: false });
} catch (e) {
  failures.push(`threw: ${e.message}`);
  await page.screenshot({ path: 'tests/Browser/clients-loading-error.png' }).catch(() => {});
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
