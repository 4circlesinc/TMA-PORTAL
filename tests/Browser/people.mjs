import { chromium } from 'playwright';

// Drives every screen in the People section against a real server. The section
// used to render from a localStorage store that was always empty, so the point
// of this script is that each screen now paints a real table from the API: the
// employees list, client contacts, prospects (both sources), both address
// books, distribution groups and the resend-welcome screen — plus the URLs,
// which used to 404 on a cold load.
//
// Needs the standard accounts (e2e@example.com Administrator, emp@example.com
// Employee, client@example.com Client), one client record with a pending
// invitation, and an account that has never signed in. See README.md.
const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8899';
const ADMIN = process.env.TMA_STAFF_EMAIL || 'e2e@example.com';
const CLIENT = process.env.TMA_CLIENT_EMAIL || 'client@example.com';

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
  await page.waitForTimeout(400);
  if (page.url().includes('/auth/login')) throw new Error('login failed for ' + email);

  // "Stay signed in?" sits in front of the whole portal — every request
  // redirects here until it is answered, so an unanswered gate makes each
  // check below pass or fail against the wrong page.
  if (page.url().includes('/auth/stay-signed-in')) {
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}),
      page.click('button[name="stay"][value="yes"]'),
    ]);
    await page.waitForTimeout(400);
  }
}

// The People view is the only visible one; read what it actually painted.
const view = (page) => page.locator('.tma-dash__view[data-view="people"]');
const rowsIn = async (page) => view(page).locator('.tma-portal-table tbody tr').count();
const bodyText = (page) => view(page).innerText();

async function open(page, path) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
}

const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.on('console', (m) => {
  if (m.type() === 'error' && !/403|404/.test(m.text())) errors.push('console: ' + m.text());
});
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

const stamp = Date.now();

try {
  step(1, 'Every People URL is served on a cold load');
  await signIn(page, ADMIN);
  const paths = [
    '/people', '/people/employees', '/people/clients', '/people/prospects',
    '/people/shared-address-book', '/people/personal-address-book',
    '/people/distribution-groups', '/people/resend-welcome-emails',
  ];
  for (const p of paths) {
    const res = await page.goto(`${BASE}${p}`, { waitUntil: 'domcontentloaded' });
    // The URL matters as much as the status: a redirect to some other page
    // also answers 200, which is exactly what a missing route looks like.
    check(res.status() === 200 && new URL(page.url()).pathname === p,
      `${p} → ${res.status()} at ${new URL(page.url()).pathname}`);
  }

  step(2, 'Manage users home counts the real directory');
  await open(page, '/people');
  const home = await bodyText(page);
  check(/Manage users/.test(home), 'home screen renders');
  check(/2 employees/.test(home), `subtitle counts staff (got: ${home.split('\n')[1]})`);
  const cards = await view(page).locator('[data-people-link]').count();
  check(cards === 7, `all seven section cards render (got ${cards})`);

  // The card icons are masked spans, not <img>: the phosphor art is
  // fill="currentColor", which through an <img> renders flat black and cannot
  // be recoloured. Only computed styles catch a broken one — a 404 mask still
  // leaves a correctly sized, correctly coloured box, so the art URL is
  // fetched too.
  const icons = await page.evaluate(() =>
    [...document.querySelectorAll('.tma-portal-module-icon')].map((tile) => {
      const art = tile.querySelector('.tma-portal-module-icon__art');
      const cs = getComputedStyle(art);
      const box = (el) => {
        const r = el.getBoundingClientRect();
        return [Math.round(r.width), Math.round(r.height)];
      };
      return {
        tile: box(tile),
        art: box(art),
        color: cs.backgroundColor,
        mask: (cs.maskImage || cs.webkitMaskImage || '').replace(/^url\(["']?|["']?\)$/g, ''),
      };
    }));
  check(icons.length === 7, `seven icon tiles (got ${icons.length})`);
  check(icons.every((i) => i.tile[0] === 44 && i.tile[1] === 44),
    `every tile is 44x44 (first ${JSON.stringify(icons[0]?.tile)})`);
  check(icons.every((i) => i.art[0] === 20 && i.art[1] === 20),
    `every icon is 20x20 (first ${JSON.stringify(icons[0]?.art)})`);
  check(new Set(icons.map((i) => i.mask)).size === 7, 'all seven masks are distinct art');
  // Stylesheet-relative, not page-relative — a page-relative url() would
  // resolve to /people/images/... and 404 on any nested People URL.
  check(icons.every((i) => new URL(i.mask).pathname.startsWith('/images/icons/phosphor/')),
    `masks resolve against the stylesheet (${icons[0]?.mask})`);
  check(icons.every((i) => i.color !== 'rgb(0, 0, 0)' && i.color !== 'rgba(0, 0, 0, 0)'),
    `icons are tinted, not black (${icons[0]?.color})`);
  const maskCodes = await page.evaluate((urls) =>
    Promise.all(urls.map((u) => fetch(u).then((r) => r.status).catch(() => 0))),
  [...new Set(icons.map((i) => i.mask))]);
  check(maskCodes.every((s) => s === 200), `every mask URL loads (${maskCodes.join(',')})`);

  step(3, 'Browse employees lists staff with their activation state');
  await open(page, '/people/employees');
  check((await rowsIn(page)) === 2, 'two staff rows');
  const employees = await bodyText(page);
  check(/Test Admin/.test(employees) && /Emp Loyee/.test(employees), 'both staff are listed');
  check(/Not activated/.test(employees), 'the account that never signed in is marked');
  check(!/Cli Ent/.test(employees), 'a client account is not on the employees screen');

  // The Showing filter is real, not decorative.
  await view(page).locator('[data-people-status]').selectOption('Active');
  await page.waitForTimeout(300);
  check((await rowsIn(page)) === 1, 'filtering to Active leaves one row');

  step(4, 'Browse client contacts reads the client accounts');
  await open(page, '/people/clients');
  const clients = await bodyText(page);
  check(/Cli Ent/.test(clients), 'the client account is listed');
  check(!/Test Admin/.test(clients), 'staff are not on the client screen');

  step(5, 'Browse prospects merges pending invites and unused accounts');
  await open(page, '/people/prospects');
  const prospects = await bodyText(page);
  check(/Selina Kyle/.test(prospects), 'the pending client invitation is listed');
  check(/Emp Loyee/.test(prospects), 'the account that never signed in is listed');
  check(!/Test Admin/.test(prospects), 'someone who has signed in is not a prospect');

  step(6, 'A contact added to the personal book persists and stays private');
  await open(page, '/people/personal-address-book');
  await view(page).locator('[data-people-contact-add]').click();
  await page.waitForSelector('[data-contact-first]', { state: 'visible' });
  await page.fill('[data-contact-first]', 'Alfred');
  await page.fill('[data-contact-last]', 'Pennyworth' + stamp);
  await page.fill('[data-contact-email]', `alfred${stamp}@example.com`);
  await page.click('[data-contact-save]');
  await page.waitForTimeout(700);
  check(/Pennyworth/.test(await bodyText(page)), 'the new contact appears in the list');

  await open(page, '/people/personal-address-book');
  check(/Pennyworth/.test(await bodyText(page)), 'and survives a reload (server-backed)');

  await open(page, '/people/shared-address-book');
  check(!/Pennyworth/.test(await bodyText(page)), 'a personal contact is not in the shared book');

  step(7, 'The shared book is account-wide');
  await view(page).locator('[data-people-contact-add]').click();
  await page.waitForSelector('[data-contact-first]', { state: 'visible' });
  await page.fill('[data-contact-first]', 'Lucius');
  await page.fill('[data-contact-last]', 'Fox' + stamp);
  await page.fill('[data-contact-company]', 'Wayne Enterprises');
  await page.click('[data-contact-save]');
  await page.waitForTimeout(700);
  check(/Lucius/.test(await bodyText(page)), 'the shared contact is listed');

  step(8, 'Distribution groups create and list a real group');
  await open(page, '/people/distribution-groups');
  await view(page).locator('[data-people-group-new]').click();
  await page.waitForSelector('[data-group-name]', { state: 'visible' });
  const groupName = 'Marketing ' + stamp;
  await page.fill('[data-group-name]', groupName);
  await page.fill('[data-group-desc]', 'Everything brand');
  const pickable = await page.locator('[data-group-member]').count();
  check(pickable >= 2, `the staff picker lists real people (got ${pickable})`);
  await page.locator('[data-group-member]').first().check();
  await page.click('[data-group-save]');
  await page.waitForTimeout(800);
  check(new RegExp(groupName).test(await bodyText(page)), 'the group appears in the table');

  await open(page, '/people/distribution-groups');
  check(new RegExp(groupName).test(await bodyText(page)), 'and survives a reload');

  step(9, 'Resend welcome emails offers the people still waiting');
  await open(page, '/people/resend-welcome-emails');
  const resend = await bodyText(page);
  check(/Waiting to activate/.test(resend), 'the waiting list renders');
  check(/emp@example\.com/.test(resend), 'the account that never signed in is offered');

  const sendOne = view(page).locator('[data-people-resend-one]').first();
  await sendOne.click();
  await page.waitForTimeout(900);
  check(!/Couldn/.test(await page.locator('body').innerText()), 'sending reports no error');

  step(10, 'A client is refused the whole section');
  const clientPage = await browser.newPage();
  await signIn(clientPage, CLIENT);
  for (const p of ['/people', '/people/employees', '/people/shared-address-book']) {
    const res = await clientPage.goto(`${BASE}${p}`, { waitUntil: 'domcontentloaded' });
    check(res.status() === 404, `a client gets 404 for ${p} (got ${res.status()})`);
  }
  await clientPage.close();
} catch (e) {
  failures.push('threw: ' + e.message);
  log('\n!! ' + e.stack);
} finally {
  await browser.close();
}

if (errors.length) {
  log('\nPage errors:');
  errors.forEach((e) => log('  ' + e));
}

log('\n' + (failures.length ? `FAILED (${failures.length})` : 'PASSED'));
failures.forEach((f) => log('  ✗ ' + f));
process.exit(failures.length ? 1 : 0);
