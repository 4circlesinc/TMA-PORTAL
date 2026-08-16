import { chromium } from 'playwright';

/*
 * The library replica: the walker pulls records into the store, and a
 * deletion pulls one back out.
 *
 * Runs the REAL desktop path in a browser by declaring TMADesktop before any
 * script loads — TMAStore reads that flag at boot, so the store gains its
 * IndexedDB tier and TMAFilesSync stops declining to run. Everything after
 * that is the production code end to end: the cursor walk, the per-page
 * cursor save, the record keys, and the tombstone that deletes one.
 *
 * Wants the standard throwaway server; leaves its folders behind.
 */
const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8899';
const EMAIL = process.env.TMA_STAFF_EMAIL || 'e2e@example.com';
const PASSWORD = process.env.TMA_STAFF_PASSWORD || 'password12345';

const failures = [];
const check = (ok, msg) => { console.log(`    ${ok ? '✓' : '✗'} ${msg}`); if (!ok) failures.push(msg); };
const step = (n, msg) => console.log(`\n[${n}] ${msg}`);

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
// Before any portal script: portal-store.js decides its disk tier from this.
await context.addInitScript(() => { window.TMADesktop = { isDesktop: true }; });
const page = await context.newPage();

async function until(fn, timeout = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await fn()) return true;
    await page.waitForTimeout(250);
  }
  return false;
}

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

  step(1, 'The walker sees a desktop store');
  await page.goto(`${BASE}/folders/all`, { waitUntil: 'domcontentloaded' });
  await until(() => page.evaluate(() => !!(window.TMAFilesSync && window.TMAStore && window.TMAFilesNet)));
  check(await page.evaluate(() => window.TMAStore.persistent), 'the store has its disk tier');

  step(2, 'A walk replicates what the account may see');
  const stamp = `Replica ${Date.now().toString(36)}`;
  const made = await page.evaluate(async (name) => {
    const parent = await window.TMAFilesNet.fetchJSON(window.TMAFilesNet.url('/folders'), {
      method: 'POST', json: { name },
    });
    const child = await window.TMAFilesNet.fetchJSON(window.TMAFilesNet.url('/folders'), {
      method: 'POST', json: { name: name + ' inside', parent: parent.id },
    });
    return { parent: parent.id, child: child.id };
  }, stamp);
  check(!!made.parent && !!made.child, 'two folders to replicate');

  const taken = await page.evaluate(() => window.TMAFilesSync.run());
  check(taken >= 2, `the walker took records in (${taken})`);

  const held = await page.evaluate(async (m) => ({
    parent: await window.TMAStore.get('files:folder:' + m.parent),
    child: await window.TMAStore.get('files:folder:' + m.child),
    cursor: await window.TMAStore.get('files:sync-cursor'),
  }), made);
  check(!!held.parent && held.parent.name === stamp, 'the parent is in the store, as its presented row');
  check(!!held.child && held.child.parent.id === made.parent, 'the child too, carrying its parent link');
  check(!!held.cursor && !!held.cursor.folders.since, 'and the cursor is saved for next time');

  step(3, 'A second walk brings only what moved');
  const again = await page.evaluate(() => window.TMAFilesSync.run());
  // Up to one row PER KIND comes again: the inclusive tie-break re-delivers
  // each cursor's boundary row so a same-instant second change can never be
  // skipped. Two kinds, so an idle walk carries at most two — never a page.
  check(again <= 2, `an idle catch-up carries only the boundary rows (${again})`);

  step(4, 'A deletion arrives as a tombstone and takes its record with it');
  await page.evaluate(async (m) => {
    await window.TMAFilesNet.fetchJSON(window.TMAFilesNet.url('/folders/' + m.child), { method: 'DELETE' });
  }, made);
  await page.evaluate(() => window.TMAFilesSync.run());
  const after = await page.evaluate(async (m) => ({
    child: await window.TMAStore.get('files:folder:' + m.child),
    parent: await window.TMAStore.get('files:folder:' + m.parent),
  }), made);
  check(after.child === undefined || after.child === null, 'the deleted folder is out of the replica');
  check(!!after.parent, 'and the survivor is untouched');
} catch (err) {
  failures.push(`threw: ${err.message}`);
  console.error(err);
} finally {
  await browser.close();
}

console.log(`\n${failures.length ? `${failures.length} FAILED` : 'all checks passed'}`);
failures.forEach(f => console.log(`  ✗ ${f}`));
process.exit(failures.length ? 1 : 0);
