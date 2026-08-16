import { chromium } from 'playwright';

/*
 * The client directory painting from the store.
 *
 * The same three promises as files-cached-listing.mjs, for the hub that
 * carries eleven thousand records against Cloud Postgres:
 *
 *   1. A visited directory is held by TMAStore under clients:directory.
 *   2. With the network cut, leaving the hub and coming back still paints
 *      the rows — the reader's own copy answering when the wire cannot.
 *   3. A write through the hub's one fetch seam (clientsFetch) drops every
 *      cached hub listing, so nothing renamed survives in yesterday's shape.
 *
 * Standard throwaway server; creates one client and renames it.
 */
const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8899';
const EMAIL = process.env.TMA_STAFF_EMAIL || 'e2e@example.com';
const PASSWORD = process.env.TMA_STAFF_PASSWORD || 'password12345';

const failures = [];
const check = (ok, msg) => { console.log(`    ${ok ? '✓' : '✗'} ${msg}`); if (!ok) failures.push(msg); };
const step = (n, msg) => console.log(`\n[${n}] ${msg}`);

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
const page = await context.newPage();

async function until(fn, timeout = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await fn()) return true;
    await page.waitForTimeout(250);
  }
  return false;
}

/* The visible hub pane — the shell keeps every view in the DOM. */
const hubText = () => page.evaluate(() => {
  const roots = [...document.querySelectorAll('[data-view-root="clients"], .tma-dash__clients, .tma-dash__view--clients')];
  const seen = roots.find(el => el.getBoundingClientRect().width > 0);
  return seen ? seen.innerText : document.body.innerText;
});

const go = (nav, view, title) => page.evaluate(({ nav, view, title }) => {
  window.TMADashboard.navigate({ navId: nav, view, title, crumb: title });
}, { nav, view, title });

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

  step(1, 'A client to look for');
  await page.goto(`${BASE}/clients`, { waitUntil: 'domcontentloaded' });
  await until(() => page.evaluate(() => !!(window.TMAClients && window.TMAStore)));

  const stamp = `Cached Person ${Date.now().toString(36)}`;
  const made = await page.evaluate(async (name) => {
    // The same shape draftPayload sends: the uid is minted client-side.
    const uid = 'cached-' + Date.now().toString(36);
    const res = await window.TMAClients.api.create({
      uid, name, initial: name.charAt(0), initialColor: 'blue',
      profile: { firstName: name.split(' ')[0], lastName: 'Person' },
    });
    return (res && res.client && res.client.id) || uid;
  }, stamp);
  check(!!made, `created "${stamp}" through the hub's own layer`);

  step(2, 'The visited directory is in the store');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await until(() => page.evaluate(() => !!window.TMAStore));
  /*
   * Asserted against the module, not the pixels: which TABLE a client
   * appears in is the application table's business (a client with no
   * application has no row there) — what the cache feeds is the directory,
   * and hasContact reads exactly that.
   */
  check(await until(() => page.evaluate((id) => window.TMAClients.hasContact(id), made)),
    'the directory holds the client after a reload');

  const held = await page.evaluate(() => {
    const hit = window.TMAStore.peek('clients:directory');
    return hit && hit.clients ? hit.clients.length : -1;
  });
  check(held >= 1, `the directory is held by the store (${held} clients)`);

  step(3, 'Offline, the directory still hydrates from the store');
  await go('dash-dashboard', 'dashboard', 'Dashboard');
  await page.waitForTimeout(800);
  await context.setOffline(true);
  await go('clients', 'clients', 'CIP Applications');
  check(await until(() => page.evaluate((id) => window.TMAClients.hasContact(id), made), 8000),
    'the directory is populated with no network');
  check(!(await hubText()).includes('didn’t answer'),
    'and no error is shown over the hub');
  await context.setOffline(false);

  step(4, 'A write through the seam empties the cache');
  const dropped = await page.evaluate(async (id) => {
    const heldBefore = window.TMAStore.peek('clients:directory') !== undefined;
    await window.TMAClients.api.update(id, {
      name: 'Renamed Through The Seam', initial: 'R',
      profile: { firstName: 'Renamed', lastName: 'Person' },
    });
    return { heldBefore, heldAfter: window.TMAStore.peek('clients:directory') !== undefined };
  }, made);
  check(dropped.heldBefore, 'the directory was held before the write');
  check(!dropped.heldAfter, 'and gone the moment the write landed');
} catch (err) {
  failures.push(`threw: ${err.message}`);
  console.error(err);
} finally {
  await browser.close();
}

console.log(`\n${failures.length ? `${failures.length} FAILED` : 'all checks passed'}`);
failures.forEach(f => console.log(`  ✗ ${f}`));
process.exit(failures.length ? 1 : 0);
