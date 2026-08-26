import { chromium } from 'playwright';

/*
 * §4d — correcting a day on the Timeline card.
 *
 * CipMilestoneTest pins the endpoint and its refusals; what only a browser can
 * check is that the card is the way in. The dates a reader may fix have to be
 * pressable, the ones they may not have to stay plain text, and the corrected
 * day has to be on the card after the save rather than only in the database —
 * the profile repaints through the morph layer, so a value that lands on the
 * server and not on the screen is the failure this exists to catch.
 *
 * Needs an administrator, FEATURE_CIP on, and one application that has
 * travelled the whole way, so every step carries a date to correct.
 */
const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8899';
const EMAIL = process.env.TMA_STAFF_EMAIL || 'e2e@example.com';
const PASSWORD = process.env.TMA_STAFF_PASSWORD || 'password12345';
const CLIENT = process.env.TMA_CLIENT_UID || 'chen-wei';

const failures = [];
const check = (ok, msg) => { console.log(`    ${ok ? '✓' : '✗'} ${msg}`); if (!ok) failures.push(msg); };
const step = (n, msg) => console.log(`\n[${n}] ${msg}`);

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 960 } })).newPage();

try {
  await page.goto(`${BASE}/auth/login`, { waitUntil: 'domcontentloaded' });
  await page.click('text=Sign in with Email');
  await page.waitForSelector('input[name="email"]', { state: 'visible' });
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}), page.click('button[type="submit"]:visible')]);
  await page.waitForTimeout(700);
  // Two forms posting the same route, told apart by their hidden `stay` — the
  // buttons read "Yes" and "Not this time", so a text selector picks the wrong
  // one or nothing at all.
  if (page.url().includes('/auth/stay-signed-in')) {
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}),
      page.click('form:has(input[name="stay"][value="yes"]) button[type="submit"]'),
    ]);
    await page.waitForTimeout(700);
  }

  step(1, 'The Timeline card draws every step, and the dates are pressable');
  await page.goto(`${BASE}/clients/${CLIENT}`, { waitUntil: 'domcontentloaded' });
  // Scoped to the Timeline card, twice over: `.tma-dash__cip-tl` is the shared
  // label/date list that Family, Documents and Assigned draw with too, and
  // every portal page lives in one SPA shell, so a bare selector also collects
  // the other cards' rows and hidden views' copies.
  const card = () => page.locator('.tma-dash__clients-card:visible')
    .filter({ has: page.locator('.tma-dash__clients-card-title', { hasText: 'Timeline' }) });
  const dayOf = label => card().locator('li', { hasText: label }).locator('.tma-dash__cip-tl-edit');

  await card().locator('.tma-dash__cip-tl').waitFor({ timeout: 30000 });

  const rows = card().locator('li');
  check(await rows.count() === 6, `six steps on the card (saw ${await rows.count()})`);

  const edits = card().locator('.tma-dash__cip-tl-edit');
  check(await edits.count() === 6, `all six days are pressable for an administrator (saw ${await edits.count()})`);

  // A plain day, not an instant: `new Date('2026-01-31')` is midnight UTC, so
  // a browser west of it drew the thirty-first as the thirtieth. The test runs
  // in whatever zone the machine is in, which is the point.
  const submitted = dayOf('Submitted');
  check(await submitted.innerText() === 'Jan 31, 2026', `Submitted reads its stored day (${await submitted.innerText()})`);

  step(2, 'Pressing a date opens the correction, and the status is not part of it');
  await submitted.click();
  await page.waitForSelector('[data-cip-milestone-input]', { timeout: 10000 });
  const modal = page.locator('.tma-portal-modal:visible').first();
  check((await modal.innerText()).includes('The status does not change.'), 'the dialog says the status does not move');
  check(await page.inputValue('[data-cip-milestone-input]') === '2026-01-31', 'the field opens on the day already recorded');

  step(3, 'The corrected day lands on the card, not only in the database');
  await page.fill('[data-cip-milestone-input]', '2026-08-16');
  await page.click('[data-cip-save-milestone]');
  await page.waitForSelector('[data-cip-milestone-input]', { state: 'detached', timeout: 15000 });
  await page.waitForTimeout(2500);

  check(await dayOf('Submitted').innerText() === 'Aug 16, 2026',
    `the card reads the corrected day (${await dayOf('Submitted').innerText()})`);

  const record = await page.evaluate(async (uid) => {
    const r = await fetch(`/portal/cip/clients/${uid}/application`, { headers: { Accept: 'application/json' } });
    return (await r.json()).application;
  }, CLIENT);
  check(record.submittedAt === '2026-08-16', `the server holds the corrected day (${record.submittedAt})`);
  check(record.status === 'granted', 'and the status did not move');

  step(4, 'A reload still shows it — the card was not only patched in place');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await card().locator('.tma-dash__cip-tl').waitFor({ timeout: 30000 });
  check(await dayOf('Submitted').innerText() === 'Aug 16, 2026',
    `the corrected day survives a reload (${await dayOf('Submitted').innerText()})`);

  step(5, 'The Activity tab says who changed it, and what it said before');
  const events = await page.evaluate(async (id) => {
    const r = await fetch(`/portal/cip/applications/${id}/events`, { headers: { Accept: 'application/json' } });
    return (await r.json()).events;
  }, record.id);
  const line = (events || []).map(e => e.what || '').find(t => t.includes('corrected the submitted date'));
  check(!!line, `the history carries the correction (${line || 'nothing found'})`);
  check(!!line && line.includes('2026-01-31') && line.includes('2026-08-16'), 'and it names both days');
} catch (err) {
  failures.push(`threw: ${err.message}`);
  console.error(err);
} finally {
  await page.screenshot({ path: 'tests/Browser/cip-milestone-dates.png', fullPage: false });
  await browser.close();
}

console.log(failures.length ? `\n${failures.length} FAILED` : '\nAll checks passed');
process.exit(failures.length ? 1 : 0);
