import { chromium } from 'playwright';

// The referral structure the CBL import needs: a client is a Private
// individual or a Company, and "Referred by" is a registered company, the
// answer "Private", or nothing recorded yet. Drives the real form and the real
// table, because the three states only differ in what the page renders — the
// API would happily return all of them either way.
//
// Setup: the standard throwaway sqlite server (README), plus three companies:
//   foreach (['Galaxy', 'Blue Media', 'Nobody Ltd'] as $n) {
//     App\Models\Company::create(['uid' => Str::slug($n), 'name' => $n, 'created_by' => $u->id]);
//   }
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
  if (page.url().includes('/auth/stay-signed-in')) {
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}),
      page.click('text=Yes, stay signed in'),
    ]);
    await page.waitForTimeout(500);
  }
  if (page.url().includes('/auth/login')) throw new Error('login failed for ' + email);
}

// Read the rendered table rather than the API: what this feature changes is
// the reading, and a row that stores 'private' but prints a dash is the bug.
// Scoped to the clients table — every page's markup lives in the one SPA
// shell, so a bare `.tma-dash__ctr--body` also collects hidden views' rows.
const CLIENT_ROW = '.tma-dash__ctable--clients .tma-dash__ctr--body';
const tableRows = (page) => page.evaluate((sel) =>
  Array.from(document.querySelectorAll(sel)).map((row) => ({
    name: row.querySelector('.tma-dash__cc--user .tma-dash__cc-truncate')?.textContent.trim(),
    type: row.querySelector('.tma-dash__cc--type')?.textContent.trim(),
    referral: row.querySelector('.tma-dash__cc--referral')?.textContent.trim(),
  })), CLIENT_ROW);

const rowFor = (rows, name) => rows.find((r) => r.name === name) || {};
// Every client this run created carries the run's stamp, so the counts hold
// whether the database is fresh or already holds an earlier run's clients.
const mine = (rows, stamp) => rows.filter((r) => r.name && r.name.includes(String(stamp)));

// The desktop sidebar can be set to Hover Overlay, and it expands over the
// left edge of the content — which is exactly where the Filter button sits.
// Park the pointer away from the rail and let it collapse before clicking.
async function restMouse(page) {
  await page.mouse.move(1200, 620);
  await page.waitForTimeout(450);
}

async function openFilterField(page, field) {
  await restMouse(page);
  await page.click('[data-clients-filter]');
  await page.waitForTimeout(300);
  await page.click(`[data-clients-filter-field="${field}"]`);
  await page.waitForTimeout(300);
}

async function createClient(page, { first, last, clientType, referral }) {
  await page.click('[data-head-dropdown-toggle]:has-text("Create client")');
  await page.click('[data-head-dropdown-item="create-new"]');
  await page.waitForSelector('[data-clients-field="firstName"]', { timeout: 8000 });
  await page.fill('[data-clients-field="firstName"]', first);
  await page.fill('[data-clients-field="lastName"]', last);
  if (clientType) await page.selectOption('[data-clients-client-type]', clientType);
  if (referral) await page.selectOption('[data-clients-referral]', referral);
  await page.click('[data-clients-save]');
  await page.waitForTimeout(700);
  await page.goto(`${BASE}/clients`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
}

// Wide enough that the sidebar never overlaps the table toolbar — the Filter
// button sits at its left edge.
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
page.on('console', (m) => {
  if (m.type() === 'error' && !/403|404/.test(m.text())) errors.push('console: ' + m.text());
});
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

const stamp = Date.now();
const JOHN = `John Smith${stamp}`;
const MARY = `Mary Brown${stamp}`;
const DAVID = `David James${stamp}`;
const SARAH = `Sarah Charles${stamp}`;
const ACME = `Acme Holdings${stamp}`;

try {
  step(1, 'Opening the Client hub');
  await signIn(page, EMAIL);
  await page.goto(`${BASE}/clients`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);

  step(2, 'The referral picker offers the registered companies');
  await page.click('[data-head-dropdown-toggle]:has-text("Create client")');
  await page.click('[data-head-dropdown-item="create-new"]');
  await page.waitForSelector('[data-clients-referral]', { timeout: 8000 });
  const options = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-clients-referral] option')).map((o) => o.textContent.trim()));
  check(options[0] === 'No referral' && options[1] === 'Private',
    'the two non-company answers come first: ' + options.slice(0, 2).join(', '));
  check(options.includes('Galaxy') && options.includes('Blue Media'),
    'every registered company is selectable as a referral source');
  await page.click('[data-clients-cancel]');
  await page.waitForTimeout(400);

  step(3, 'Creating the four cases from the spec');
  await createClient(page, { first: JOHN, last: '', referral: 'company:galaxy' });
  await createClient(page, { first: MARY, last: '', referral: 'company:blue-media' });
  await createClient(page, { first: DAVID, last: '', referral: 'private' });
  await createClient(page, { first: SARAH, last: '' });
  await createClient(page, { first: ACME, last: '', clientType: 'company', referral: 'company:galaxy' });

  step(4, 'The table tells the four states apart');
  // The page-size control cycles 5 → 10 → 20 on click, so click until every
  // client this run created is on one page.
  for (let i = 0; i < 3; i += 1) {
    if (await page.locator('[data-clients-page-size] .tma-pagination__label').textContent() === '20') break;
    await page.click('[data-clients-page-size]');
    await page.waitForTimeout(300);
  }
  const rows = await tableRows(page);
  check(rowFor(rows, JOHN).referral === 'Galaxy', `${JOHN} → Galaxy (got "${rowFor(rows, JOHN).referral}")`);
  check(rowFor(rows, MARY).referral === 'Blue Media', `${MARY} → Blue Media (got "${rowFor(rows, MARY).referral}")`);
  check(rowFor(rows, DAVID).referral === 'Private', `${DAVID} → Private (got "${rowFor(rows, DAVID).referral}")`);
  check(rowFor(rows, SARAH).referral === '—', `${SARAH} → — (got "${rowFor(rows, SARAH).referral}")`);
  check(rowFor(rows, JOHN).type === 'Private', 'a company referral does not make the applicant a company');
  check(rowFor(rows, ACME).type === 'Company', `${ACME} is typed Company`);

  step(5, 'Referred by survives a reload (it is a column, not a draft)');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  const reloaded = await tableRows(page);
  check(rowFor(reloaded, JOHN).referral === 'Galaxy', 'Galaxy referral persisted');
  check(rowFor(reloaded, DAVID).referral === 'Private', 'Private referral persisted');

  step(6, 'Filtering by one company');
  await openFilterField(page, 'referral');
  const values = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-clients-filter-value]')).map((b) => ({
      value: b.getAttribute('data-clients-filter-value'),
      label: b.querySelector('.tma-filter-popover__item-label')?.textContent.trim(),
    })));
  check(values.some((v) => v.value === 'company:galaxy'), 'Galaxy is offered as a filter value');
  check(!values.some((v) => v.value === 'company:nobody-ltd'),
    'a company that has referred nobody is not offered (it would return nothing)');

  await page.click('[data-clients-filter-value="company:galaxy"]');
  await page.waitForTimeout(500);
  const galaxyOnly = await tableRows(page);
  check(mine(galaxyOnly, stamp).length === 2,
    `Galaxy shows its 2 referrals (got ${mine(galaxyOnly, stamp).length})`);
  check(galaxyOnly.every((r) => r.referral === 'Galaxy'), 'every visible row is a Galaxy referral');
  check(await page.locator('.tma-dash__filter-tag:has-text("Referred by: Galaxy")').isVisible(),
    'the applied filter shows as a chip');

  step(7, 'Filtering by Private, and by No referral');
  await openFilterField(page, 'referral');
  await page.click('[data-clients-filter-value="private"]');
  await page.waitForTimeout(500);
  const privateOnly = mine(await tableRows(page), stamp);
  check(privateOnly.length === 1 && privateOnly[0].name === DAVID,
    `Private shows only ${DAVID} (got ${privateOnly.map((r) => r.name).join(', ')})`);

  await openFilterField(page, 'referral');
  await page.click('[data-clients-filter-value="none"]');
  await page.waitForTimeout(500);
  const noneOnly = mine(await tableRows(page), stamp);
  check(noneOnly.length === 1 && noneOnly[0].name === SARAH,
    `No referral shows only ${SARAH} (got ${noneOnly.map((r) => r.name).join(', ')})`);

  step(8, 'Filtering by client type, and resetting');
  await restMouse(page);
  await page.click('[data-clients-reset-filters]');
  await page.waitForTimeout(400);
  await openFilterField(page, 'clientType');
  await page.click('[data-clients-filter-value="company"]');
  await page.waitForTimeout(500);
  const companyType = mine(await tableRows(page), stamp);
  check(companyType.length === 1 && companyType[0].name === ACME,
    `Company type shows only ${ACME} (got ${companyType.map((r) => r.name).join(', ')})`);

  await restMouse(page);
  await page.click('[data-clients-reset-filters]');
  await page.waitForTimeout(500);
  check(mine(await tableRows(page), stamp).length === 5, 'Reset brings every client back');

  step(9, 'Editing a client keeps its referral in the form');
  // Search first: with the page size at 10 the row would otherwise be on
  // whichever page an earlier run's clients pushed it to.
  await page.fill('[data-clients-search]', MARY);
  await page.waitForTimeout(600);
  // The name cell, not the row: the row's centre is the Referred by cell, and
  // clicking a referrer's name opens the company (which is what it is for).
  await page.click(`${CLIENT_ROW}:has-text("${MARY}") .tma-dash__cc--user`);
  await page.waitForTimeout(900);
  await page.click('[data-clients-edit]:visible');
  await page.waitForSelector('[data-clients-referral]', { timeout: 8000 });
  const selected = await page.inputValue('[data-clients-referral]');
  check(selected === 'company:blue-media', `the edit form reopens on Blue Media (got "${selected}")`);

  step(10, 'A referrer name in the table opens the company that referred them');
  await page.goto(`${BASE}/clients`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  await page.fill('[data-clients-search]', MARY);
  await page.waitForTimeout(600);
  await page.click(`${CLIENT_ROW} [data-clients-open-company]`);
  await page.waitForTimeout(900);
  // The company's name is drawn in the page head chrome, outside the detail
  // panel, so the URL is what says which record we landed on.
  check(page.url().includes('/clients/companies/blue-media'),
    `the Referred by cell links through to the company (at ${page.url()})`);
  check(await page.locator('.tma-dash__clients-detail:has-text("Clients referred")').first().isVisible(),
    'the company profile reports how many clients it referred');
} catch (e) {
  failures.push('threw: ' + e.message);
  await page.screenshot({ path: 'tests/Browser/client-referrals.png', fullPage: true }).catch(() => {});
} finally {
  await browser.close();
}

log('\n' + '─'.repeat(56));
errors.forEach((e) => log('  ! ' + e));
if (failures.length) {
  log(`✗ ${failures.length} failed`);
  failures.forEach((f) => log('  - ' + f));
  process.exit(1);
}
log('✓ all checks passed');
