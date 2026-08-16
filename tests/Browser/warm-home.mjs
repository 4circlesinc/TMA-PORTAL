import { chromium } from 'playwright';

/*
 * The dashboard opens the way it was quit — no skeletons, no tiles filling
 * in one by one.
 *
 * The claim is proved the only honest way: visit once so the snapshots are
 * taken, then reload with every data endpoint KILLED. Whatever the board
 * shows on that reload can only have come from the store — a skeleton, an
 * empty tile or a missing greeting means warm boot failed, because the
 * network was never going to answer.
 *
 * Desktop path (TMADesktop declared before boot) so the snapshots survive in
 * IndexedDB, exactly as they do across a quit of the installed app.
 *
 * Standard throwaway server; leaves a client and folders behind.
 */
const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8899';
const EMAIL = process.env.TMA_STAFF_EMAIL || 'e2e@example.com';
const PASSWORD = process.env.TMA_STAFF_PASSWORD || 'password12345';

const failures = [];
const check = (ok, msg) => { console.log(`    ${ok ? '✓' : '✗'} ${msg}`); if (!ok) failures.push(msg); };
const step = (n, msg) => console.log(`\n[${n}] ${msg}`);

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
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

  step(1, 'A warm visit takes the snapshots');
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  // Let every tile load and write its snapshot.
  check(await until(() => page.evaluate(() =>
    document.body.innerText.includes('Hello '))), 'the greeting painted');
  await page.waitForTimeout(4000);

  const snaps = await page.evaluate(async () => ({
    files: !!(await window.TMAStore.get('home:files')),
    metrics: !!(await window.TMAStore.get('home:metrics')),
    staff: !!(await window.TMAStore.get('home:staff')),
    email: !!(await window.TMAStore.get('home:email')),
    chats: !!(await window.TMAStore.get('home:chats')),
    me: !!localStorage.getItem('tma.me'),
  }));
  Object.entries(snaps).forEach(([k, v]) => check(v, `snapshot taken: ${k}`));

  step(2, 'Reload with every data endpoint dead');
  // The document and static assets still serve (the desktop's shell and
  // bundle would); the DATA cannot. Anything painted is the store's doing.
  await context.route(/\/(me$|portal\/(mail|messaging|dashboard)\b)/, (route) => route.abort());

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  const body = () => page.evaluate(() => document.body.innerText);
  check((await body()).includes('Hello '), 'the greeting is there — no shimmer where the name was');
  check(await page.evaluate(() =>
    !document.querySelector('.tma-portal-hello__title.tma-skeleton')),
  'and it is painted text, not a skeleton');

  const skeletons = await page.evaluate(() => {
    const mountEl = document.querySelector('[data-view="dashboard"] [data-portal-mount]');
    return mountEl ? mountEl.querySelectorAll('.tma-skeleton, .tma-skeleton-row').length : -1;
  });
  check(skeletons === 0, `no tile is a skeleton (${skeletons})`);

  // The board's substance, not just its chrome: the file tile shows rows
  // held from last time.
  const held = await page.evaluate(async () => {
    const snap = await window.TMAStore.get('home:files');
    return snap && snap.recentFiles && snap.recentFiles[0] ? snap.recentFiles[0].name : null;
  });
  if (held) {
    check((await body()).includes(held), `the recent-files tile shows its held rows ("${held}")`);
  } else {
    console.log('    (no recent files in this database — row check skipped)');
  }
} catch (err) {
  failures.push(`threw: ${err.message}`);
  console.error(err);
} finally {
  await browser.close();
}

console.log(`\n${failures.length ? `${failures.length} FAILED` : 'all checks passed'}`);
failures.forEach(f => console.log(`  ✗ ${f}`));
process.exit(failures.length ? 1 : 0);
