import { chromium } from 'playwright';
import { tinyPdfBuffer } from './fixtures/tiny-pdf.mjs';
import { deflateSync } from 'node:zlib';

/*
 * An application, edited with the network switched off.
 *
 * This is the one thing PHPUnit cannot pin. The server half — the sync cursor
 * — has its own Feature test; what has to be proved here is the half that
 * only exists in a browser: that a save which cannot be delivered is kept
 * rather than lost, that the reader is told plainly where it is, and that it
 * arrives on its own when the connection comes back.
 *
 * The offline switch is Playwright's, on the CONTEXT rather than on a route
 * handler, so fetch rejects the way it does on a train instead of answering a
 * status code. That distinction is the whole design: a status code means the
 * server disagreed and must not be queued.
 *
 * Two things are deliberately not asserted here. Filing a NEW application
 * offline queues the write but does not invent a client record to show, and
 * an application never opened while online cannot be edited offline in a
 * browser — the read cache is memory there by the firm's own decision (see
 * portal-store.js). Both are in docs/offline-plan.md.
 *
 * Wants the same setup as cip-intake.mjs: an officer or administrator, a
 * provider to file under, FEATURE_CIP on, and a throwaway database.
 */
const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8899';
const EMAIL = process.env.TMA_STAFF_EMAIL || 'e2e@example.com';
const PASSWORD = process.env.TMA_STAFF_PASSWORD || 'password12345';

/* A solid square PNG — the passport photo is measured, so it has to be real
   bytes. Same builder as cip-intake.mjs, trimmed to the one size used here. */
function png(size) {
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = buf => {
    let c = 0xffffffff;
    for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;

  const raw = Buffer.alloc(size * (1 + size * 3));
  for (let y = 0; y < size; y++) {
    const row = y * (1 + size * 3);
    for (let x = 0; x < size; x++) {
      raw[row + 1 + x * 3] = 200;
      raw[row + 2 + x * 3] = 210;
      raw[row + 3 + x * 3] = 220;
    }
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function pdf() {
  return tinyPdfBuffer();
}

const failures = [];
const check = (ok, msg) => { console.log(`    ${ok ? '✓' : '✗'} ${msg}`); if (!ok) failures.push(msg); };
const step = (n, msg) => console.log(`\n[${n}] ${msg}`);

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
const page = await context.newPage();

/** Wait for something to become true, rather than sleeping and hoping. */
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

  step(1, 'File an application to edit');
  // Through the hub's own control rather than the wizard's URL: the form is
  // a view inside one SPA shell, and a deep link to it paints a hidden node.
  await page.goto(`${BASE}/clients`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-head-dropdown-item="create-new"]', { state: 'attached', timeout: 30000 });
  await page.waitForTimeout(1200);
  await page.locator('button[data-head-dropdown-toggle]').last().click();
  await page.waitForTimeout(400);
  await page.locator('[data-head-dropdown-item="create-new"]').click();
  await page.waitForSelector('[data-cip-form]', { timeout: 25000 });

  await page.fill('[data-cip-field="firstName"]', 'Nadia');
  await page.fill('[data-cip-field="lastName"]', 'Kassem');
  await page.selectOption('[data-cip-field="gender"]', 'Female');
  await page.fill('[data-cip-field="dateOfBirth"]', '1988-02-03');
  await page.selectOption('[data-cip-field="countryOfBirth"]', 'Lebanon');
  await page.selectOption('[data-cip-field="countryOfResidence"]', 'United Arab Emirates');
  await page.fill('[data-cip-field="occupation"]', 'Architect');
  await page.fill('[data-cip-field="passportNumber"]', 'K7654321');
  await page.selectOption('[data-cip-field="investmentType"]', 'real_estate');
  await page.selectOption('[data-cip-field="sponsored"]', '0');
  if (await page.locator('[data-cip-field="providerId"]').count()) {
    const value = await page.$eval('[data-cip-field="providerId"] option:nth-child(2)', o => o.value);
    await page.selectOption('[data-cip-field="providerId"]', value);
  }
  await page.setInputFiles('[data-cip-photo="passportPhoto"]', {
    name: 'passport.png', mimeType: 'image/png', buffer: png(600),
  });
  await page.setInputFiles('[data-cip-file="passportBioPage"]', {
    name: 'bio.pdf', mimeType: 'application/pdf', buffer: pdf(),
  });
  await page.setInputFiles('[data-cip-file="birthCertificate"]', {
    name: 'birth.pdf', mimeType: 'application/pdf', buffer: pdf(),
  });
  await page.waitForTimeout(600);
  await page.click('[data-cip-save]');
  check(await until(() => page.locator('[data-cip-form]').count().then(n => n === 0), 30000),
    'the application filed');

  // Whose record it is, and which application, straight from the server —
  // the URLs below are the ones the portal itself uses.
  const filed = await page.evaluate(async () => {
    const res = await fetch('/portal/cip/applications/sync', { headers: { Accept: 'application/json' } });
    const json = await res.json();

    return json.applications[json.applications.length - 1];
  });
  check(!!filed && filed.applicant.firstName === 'Nadia', `filed as ${filed && filed.number}`);

  step(2, 'Open it for editing, with a connection');
  await page.goto(`${BASE}/clients/${filed.clientUid}`, { waitUntil: 'domcontentloaded' });
  try {
    await page.waitForSelector('[data-clients-edit-application]', { timeout: 30000 });
  } catch (e) {
    console.log('DBG url:', page.url());
    console.log('DBG detail:', (await page.locator('.tma-dash__clients-detail:visible').first().innerText().catch(() => '(no detail pane)')).slice(0, 300));
    console.log('DBG hasContact:', await page.evaluate((u) => window.TMAClients.hasContact(u), filed.clientUid));
    throw e;
  }
  await page.locator('[data-clients-edit-application]').click();
  await page.waitForSelector('[data-cip-form]', { timeout: 25000 });
  check(await page.inputValue('[data-cip-field="firstName"]') === 'Nadia',
    'the filed answers are in the form');

  step(3, 'The connection goes, and the save is kept');
  await context.setOffline(true);
  await page.fill('[data-cip-field="occupation"]', 'Structural Engineer');
  await page.click('[data-cip-save]');

  // Parked, not lost — and parked on disk, so a reload would not take it.
  // Waited for on the queue itself rather than on the indicator: the pill is
  // already up the moment the connection drops, so it would answer before the
  // save had been attempted at all.
  check(await until(async () => (await page.evaluate(() => window.TMAQueue.all())).length === 1),
    'the write is on the queue');
  const queued = await page.evaluate(() => window.TMAQueue.all());
  check(queued.length === 1 && queued[0].kind === 'cip.application',
    `one application write is on the queue (${queued.length})`);
  check(await until(async () => (await page.locator('.tma-sync-pill').innerText()).toLowerCase().includes('waiting')),
    `the indicator says the change is waiting (${(await page.locator('.tma-sync-pill').innerText()).trim()})`);
  check(queued[0].parts.some(p => p.value === 'Structural Engineer'),
    'carrying the answer that was typed');

  step(4, 'The screen behind shows what was typed, and says where it is');
  /*
   * Clicked through, not reloaded. A hard navigation with no network asks the
   * browser for a document nobody can serve, and the offline shell that would
   * answer it is a later phase (docs/offline-plan.md) — so what is being
   * pinned here is the portal already open, which is the case the write queue
   * was built for.
   */
  // Driven through the hub's own router rather than by clicking a row: the
  // row is one of several the shell keeps in the DOM for views that are not
  // on screen, and `:visible` on the panel it opens is not enough to tell
  // which record a click actually landed on.
  await page.evaluate(u => {
    history.pushState({}, '', `/clients/${u}`);
    window.TMAClients.syncRoute(window.TMAClients.routeFromPath(`/clients/${u}`));
  }, filed.clientUid);
  await page.waitForTimeout(800);
  check(await until(async () => (await page.locator('.tma-dash__clients-detail:visible').first().innerText())
    .includes('Structural Engineer')), 'the profile shows the edited answer');
  check((await page.locator('.tma-dash__clients-detail:visible').first().innerText()).includes('Saved on this device'),
    'and says it has not reached the firm yet');

  step(5, 'The connection comes back and the change goes on its own');
  await context.setOffline(false);
  // Nothing is clicked: the queue's own `online` listener is what has to run.
  check(await until(async () => (await page.evaluate(() => window.TMAQueue.all())).length === 0, 30000),
    'the queue empties by itself');

  const server = await page.evaluate(async id => {
    const res = await fetch(`/portal/cip/applications/${id}`, { headers: { Accept: 'application/json' } });

    return (await res.json()).application;
  }, filed.id);
  check(server.applicant.occupation === 'Structural Engineer',
    `the server holds the change (${server.applicant.occupation})`);

  check(await until(() => page.locator('.tma-sync-pill').count().then(n => n === 0)),
    'the indicator goes away');
  check(await until(async () => !(await page.locator('.tma-dash__clients-detail:visible').first().innerText())
    .includes('Saved on this device')), 'and the "saved on this device" line comes off the profile');

  step(6, 'A change the server refuses is kept for a person, not dropped');
  /*
   * Queued by hand, because there is no way to type an application the form
   * itself would accept and the server would not — which is the point: the
   * only writes that reach this state are ones a rule changed under. It must
   * not be retried forever and must not be silently binned.
   */
  await page.evaluate(() => window.TMAQueue.add({
    kind: 'cip.application',
    label: 'A change that cannot land',
    method: 'POST',
    url: '/portal/cip/applications/00000000-0000-0000-0000-000000000000',
    parts: [{ name: 'sponsored', value: '0' }],
    invalidate: [],
  }));

  check(await until(async () => {
    const entries = await page.evaluate(() => window.TMAQueue.all());

    return entries.length === 1 && entries[0].state === 'failed';
  }, 30000), 'it is parked as needing attention rather than retried');
  check((await page.locator('.tma-sync-pill').innerText()).includes('needs attention'),
    'the indicator says so');

  await page.click('.tma-sync-pill');
  await page.waitForSelector('.tma-sync-panel', { timeout: 10000 });
  check((await page.locator('.tma-sync-panel').innerText()).includes('A change that cannot land'),
    'opening it names the change');
  await page.click('[data-sync-forget]');
  check(await until(async () => (await page.evaluate(() => window.TMAQueue.all())).length === 0),
    'and Discard is what removes it — nothing else does');
} catch (err) {
  failures.push(`threw: ${err.message}`);
  console.error(err);
} finally {
  await browser.close();
}

console.log(`\n${failures.length ? `${failures.length} FAILED` : 'all checks passed'}`);
failures.forEach(f => console.log(`  ✗ ${f}`));
process.exit(failures.length ? 1 : 0);
