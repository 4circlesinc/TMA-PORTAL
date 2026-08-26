import { chromium } from 'playwright';

/*
 * The File Library painting from the store.
 *
 * Three promises, each the kind that silently stops being true:
 *
 *   1. A listing already seen is held by the store — the second visit to a
 *      folder painting instantly is the whole point of the cache.
 *   2. With the network gone, moving between sections already visited still
 *      shows their rows — the swr fallback swallowing the failed refresh
 *      instead of erroring, which is the offline design working.
 *   3. A write drops every cached listing, through the one seam all File
 *      Library writes share — a rename that survived in the cache would
 *      show the old name to the next visit.
 *
 * "From the store" is asserted by cutting the network, not by racing a
 * stopwatch: rows that paint while offline can only have come from it.
 *
 * Wants the standard throwaway server (see README) — it creates a folder and
 * renames it, and leaves it behind.
 */
const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8899';
const EMAIL = process.env.TMA_STAFF_EMAIL || 'e2e@example.com';
const PASSWORD = process.env.TMA_STAFF_PASSWORD || 'password12345';

const LISTING_KEY = 'files:listing:section=all&sort=name&dir=asc&perPage=0';

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

/* The visible library pane — the shell keeps every view in the DOM. */
const listing = () => page.evaluate(() => {
  const roots = [...document.querySelectorAll('.tma-files, [data-files-root]')];
  const seen = roots.find(el => el.getBoundingClientRect().width > 0);
  return seen ? seen.innerText : document.body.innerText;
});

/* Section switches go through the portal's own router rather than sidebar
   clicks: the nested rows' visibility depends on the group being open and on
   the user's sidebar style, neither of which is what this test is about. */
const sectionGo = (nav, title) => page.evaluate(({ nav, title }) => {
  window.TMADashboard.navigate({ navId: nav, view: 'folders', title, crumb: 'File Library / ' + title });
}, { nav, title });

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
      page.click('button[type="submit"]:visible'),
    ]);
    await page.waitForTimeout(700);
  }

  step(1, 'A folder to look at');
  await page.goto(`${BASE}/folders/all`, { waitUntil: 'domcontentloaded' });
  await until(() => page.evaluate(() => !!(window.TMAFilesNet && window.TMAStore)));

  const stamp = `Cached ${Date.now().toString(36)}`;
const renamed = `${stamp} renamed`;
  const made = await page.evaluate(async (name) => {
    const res = await window.TMAFilesNet.fetchJSON(window.TMAFilesNet.url('/folders'), {
      method: 'POST', json: { name },
    });
    // The endpoint answers with the presented folder itself, not a wrapper.
    return res && res.id;
  }, stamp);
  check(!!made, `created "${stamp}" through the seam`);

  step(2, 'A visited listing is in the store');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await until(() => page.evaluate(() => !!window.TMAStore));
  check(await until(async () => (await listing()).includes(stamp)),
    'the listing shows the folder');

  const held = await page.evaluate(
    (key) => { const hit = window.TMAStore.peek(key); return hit ? (hit.folders || []).length : -1; },
    LISTING_KEY,
  );
  check(held >= 1, `the listing is held by the store (${held} folders)`);

  // Visit a second section online, so offline has two to move between.
  await sectionGo('folders-personal', 'Personal Folders');
  await page.waitForTimeout(1500);

  step(3, 'Offline, moving between visited sections still paints them');
  await context.setOffline(true);
  await sectionGo('folders-all', 'All Files');
  check(await until(async () => (await listing()).includes(stamp), 8000),
    'All Files shows its rows with no network');
  check(!(await listing()).includes('Could not load'),
    'and no error is shown over them');
  await context.setOffline(false);

  step(4, 'A write empties the cache through the seam');
  const dropped = await page.evaluate(async ({ id, key, renamed }) => {
    await window.TMAFilesNet.fetchJSON(window.TMAFilesNet.url('/folders/' + id), {
      method: 'PATCH', json: { name: renamed },
    });
    return window.TMAStore.peek(key) === undefined;
  }, { id: made, key: LISTING_KEY, renamed });
  check(dropped, 'the cached listing is gone the moment the write lands');

  // And the refetch it forces shows the new name, not the cached old one.
  await page.reload({ waitUntil: 'domcontentloaded' });
  check(await until(async () => (await listing()).includes(renamed)),
    'the next visit shows the rename');
} catch (err) {
  failures.push(`threw: ${err.message}`);
  console.error(err);
} finally {
  await browser.close();
}

console.log(`\n${failures.length ? `${failures.length} FAILED` : 'all checks passed'}`);
failures.forEach(f => console.log(`  ✗ ${f}`));
process.exit(failures.length ? 1 : 0);
