import { chromium } from 'playwright';

/*
 * §9's counts, in the two places they are shown: one card on the portal home,
 * and the applications table's own filter.
 *
 * The harness seeds a different number into every bucket — 3, 1, 4, 2, 5, 6,
 * 1, 2, 7, 1 — because ten counts that are all the same can be produced by a
 * card that is simply wrong in a consistent way. It also seeds one DRAFT,
 * which belongs in no bucket at all: the total is the evidence it was left
 * out rather than quietly counted somewhere.
 *
 * What is really being tested is that the count and the list agree. A chip
 * saying six that opens onto nine rows is worse than no chip: it is the
 * portal telling somebody there is work they then cannot find.
 *
 * The card shows the queues holding work first and folds the ones sitting at
 * zero away behind a line, so this seed — every bucket busy — is deliberately
 * the case where nothing folds: ten rows, no toggle. The fold itself is a
 * class on state, checked in step 1b by emptying the card's data rather than
 * by seeding a second book.
 */
const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8899';
const EMAIL = process.env.TMA_STAFF_EMAIL || 'e2e@example.com';
const PASSWORD = process.env.TMA_STAFF_PASSWORD || 'password12345';

/** What the harness seeded, in the order §9 names them. */
const EXPECTED = [
  ['New Applications', 3],
  ['Review Applications', 1],
  ['Assessment Feedback', 4],
  ['Updates Required', 2],
  ['Ready to Submit', 5],
  ['Pending Review', 6],
  ['Background Check', 1],
  ['Delayed', 2],
  ['Approved', 7],
  ['Denied', 1],
];

const failures = [];
const check = (ok, msg) => { console.log(`    ${ok ? '✓' : '✗'} ${msg}`); if (!ok) failures.push(msg); };
const step = (n, msg) => console.log(`\n[${n}] ${msg}`);

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1100 } })).newPage();
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

  /* ── The card ──────────────────────────────────── */

  step(1, 'One card on the Dashboard, with every bucket and its count');
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-tile-id="cipStatus"]', { timeout: 60000 });
  await page.waitForFunction(
    () => !document.querySelector('[data-tile-id="cipStatus"]')?.hasAttribute('aria-busy'),
    { timeout: 30000 },
  ).catch(() => {});
  await page.waitForTimeout(1200);

  const cards = await page.$$('[data-tile-id="cipStatus"]');
  check(cards.length === 1, `exactly one card (${cards.length})`);

  const rows = await page.evaluate(() =>
    [...document.querySelectorAll('[data-tile-id="cipStatus"] .tma-portal-cip__row')].map(li => ({
      key: li.querySelector('[data-home-cip-bucket]')?.getAttribute('data-home-cip-bucket') || '',
      label: li.querySelector('.tma-portal-cip__label')?.innerText.trim() || '',
      count: li.querySelector('.tma-portal-cip__pill')?.innerText.trim() || '',
      // The tone lives on the row now: the dot and the count pill both read
      // it, and a colour named twice is a colour that can disagree with itself.
      tone: [...li.classList].find(c => c.startsWith('tma-portal-cip__row--')) || '',
    })));

  check(rows.length === EXPECTED.length, `${EXPECTED.length} rows (${rows.length})`);
  EXPECTED.forEach(([label, count], i) => {
    const row = rows[i] || {};
    check(row.label === label && row.count === String(count),
      `${label} = ${count} (got "${row.label}" = "${row.count}")`);
  });
  check(rows.every(r => r.tone), 'every row carries a status tone');

  /*
   * The tones must be painted, not merely emitted. A dot class with no rule
   * behind it is an invisible marker that reads as a missing colour, and it is
   * exactly what a contract split across two files gets wrong.
   */
  const unpainted = await page.evaluate(() =>
    [...document.querySelectorAll('[data-tile-id="cipStatus"] .tma-portal-cip__dot')]
      .filter(d => {
        const bg = getComputedStyle(d).backgroundColor;
        return !bg || bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent';
      }).length);
  check(unpainted === 0, `every tone dot is actually painted (${unpainted} blank)`);

  /*
   * The pill behind each count is the tone mixed toward black, so it can only
   * be transparent if the mix failed — which is what an unsupported
   * color-mix() or a tone the row never received would look like, and white
   * digits on nothing is a count nobody can read.
   */
  const flatPills = await page.evaluate(() =>
    [...document.querySelectorAll('[data-tile-id="cipStatus"] .tma-portal-cip__pill')]
      .filter(p => {
        const bg = getComputedStyle(p).backgroundColor;
        return !bg || bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent';
      }).length);
  check(flatPills === 0, `every count pill is filled (${flatPills} blank)`);

  /*
   * The figure the card leads on. 32 across the ten buckets, and the DRAFT is
   * the evidence: it is the administrator's application too, so a total that
   * counted the book rather than the buckets would read 33.
   */
  const total = await page.evaluate(() => {
    const el = document.querySelector('[data-tile-id="cipStatus"] .tma-portal-cip__total');
    return {
      figure: el?.querySelector('b')?.innerText.trim() || '',
      noun: el?.querySelector('span')?.innerText.trim() || '',
    };
  });
  check(total.figure === '32', `the total reads 32 (got "${total.figure}")`);
  check(total.noun === 'applications', `and says what it counts (got "${total.noun}")`);

  // Every bucket is busy in this seed, so there is nothing to fold and no
  // line offering to.
  const toggles = await page.$$('[data-tile-id="cipStatus"] [data-home-cip-zeros]');
  check(toggles.length === 0, `no "stages clear" line when every queue has work (${toggles.length})`);

  step('1b', 'The queues sitting at zero fold away behind one line');
  /*
   * Driven through the card's own data rather than a second seeded book: the
   * fold is a property of the render, and re-seeding ten statuses to prove it
   * would test the fixture. The dashboard endpoint is answered with the real
   * payload minus most of its counts, then the card is asked to repaint.
   */
  await page.route('**/portal/cip/dashboard', async route => {
    const res = await route.fetch();
    const body = await res.json();
    body.buckets = body.buckets.map((b, i) => (i === 0 ? b : { ...b, count: 0 }));
    body.total = body.buckets[0].count;
    await route.fulfill({ response: res, json: body });
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-tile-id="cipStatus"] .tma-portal-cip__row', { timeout: 60000 });
  await page.waitForTimeout(1500);

  const folded = await page.evaluate(() => {
    const card = document.querySelector('[data-tile-id="cipStatus"]');
    const toggle = card?.querySelector('[data-home-cip-zeros]');
    return {
      busy: card?.querySelectorAll('.tma-portal-cip__row').length || 0,
      clear: card?.querySelectorAll('.tma-portal-cip__zrow').length || 0,
      toggle: toggle?.innerText.replace(/\s+/g, ' ').trim() || '',
      expanded: toggle?.getAttribute('aria-expanded') || '',
      shown: card?.querySelector('.tma-portal-cip__zeros')?.offsetHeight || 0,
    };
  });
  check(folded.busy === 1, `only the one busy queue keeps a row (${folded.busy})`);
  check(folded.clear === 9, `the other nine are still on the card, folded (${folded.clear})`);
  check(/9 stages clear/.test(folded.toggle), `one line says how many (got "${folded.toggle}")`);
  check(folded.expanded === 'false' && folded.shown === 0, 'and they start hidden');

  await page.click('[data-tile-id="cipStatus"] [data-home-cip-zeros]');
  await page.waitForTimeout(600);
  const opened = await page.evaluate(() => {
    const card = document.querySelector('[data-tile-id="cipStatus"]');
    return {
      expanded: card?.querySelector('[data-home-cip-zeros]')?.getAttribute('aria-expanded') || '',
      shown: card?.querySelector('.tma-portal-cip__zeros')?.offsetHeight || 0,
      // The tile must have grown to hold them, not hidden them in a scroller.
      overflow: (() => {
        const body = card?.querySelector('.tma-portal-panel__body');
        return body ? body.scrollHeight - body.clientHeight : -1;
      })(),
    };
  });
  check(opened.expanded === 'true', 'pressing it says so');
  check(opened.shown > 0, `the folded rows are showing (${opened.shown}px)`);
  check(opened.overflow <= 1, `and the card grew to hold them (${opened.overflow}px hidden)`);

  await page.unroute('**/portal/cip/dashboard');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-tile-id="cipStatus"] .tma-portal-cip__row', { timeout: 60000 });
  await page.waitForTimeout(1500);

  /* ── The card opens the table, filtered ────────── */

  step(2, 'A row opens the applications table filtered to that bucket');
  await page.click('[data-home-cip-bucket="pending_review"]');
  await page.waitForTimeout(4000);
  await page.waitForSelector('.tma-cip-table tbody tr[data-cip-open]', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1500);

  const landed = await page.evaluate(() => ({
    url: window.location.pathname + window.location.search,
    rows: document.querySelectorAll('.tma-cip-table tbody tr[data-cip-open]').length,
    statuses: [...new Set([...document.querySelectorAll('.tma-cip-table tbody tr .tma-portal-status')]
      .map(s => s.innerText.trim()))],
  }));

  check(landed.rows === 6, `the six Pending review applications are listed (${landed.rows})`);
  check(landed.statuses.length === 1 && /pending/i.test(landed.statuses[0] || ''),
    `and nothing else (${JSON.stringify(landed.statuses)})`);
  check(/bucket=pending_review/.test(landed.url), `the address bar says so (${landed.url})`);

  step(3, 'The filter survives a reload');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.tma-cip-table tbody tr[data-cip-open]', { timeout: 60000 });
  await page.waitForTimeout(2500);
  const reloaded = await page.evaluate(() => ({
    rows: document.querySelectorAll('.tma-cip-table tbody tr[data-cip-open]').length,
    url: window.location.pathname + window.location.search,
  }));
  check(reloaded.rows === 6, `still the same six after a reload (${reloaded.rows})`);
  check(/bucket=pending_review/.test(reloaded.url), 'and the URL still describes it');

  /* ── The table's own filter ────────────────────── */

  step(4, 'The chips are gone and Status is a filter');
  const chips = await page.evaluate(() => ({
    old: document.querySelectorAll('[data-cip-bucket], .tma-dash__cip-buckets, .tma-dash__cip-bucket').length,
    active: [...document.querySelectorAll('[data-clients-chip], .tma-dash__clients-chip, .tma-dash__filter-chip')]
      .map(c => c.innerText.replace(/\s+/g, ' ').trim()),
  }));
  check(chips.old === 0, `no bucket chip cards remain (${chips.old})`);
  check(chips.active.some(c => /pending review/i.test(c)),
    `the active status shows as a removable chip (${JSON.stringify(chips.active)})`);

  step(5, 'The filter menu offers every bucket, with its count');
  await page.click('[data-clients-filter]');
  await page.waitForTimeout(700);
  const fields = await page.evaluate(() =>
    [...document.querySelectorAll('[data-clients-filter-field]')].map(b => ({
      field: b.getAttribute('data-clients-filter-field'),
      text: b.innerText.replace(/\s+/g, ' ').trim(),
    })));
  const statusField = fields.find(f => f.field === 'status');
  check(!!statusField, `Status is offered as a filter (${JSON.stringify(fields.map(f => f.field))})`);
  check(!!statusField && /pending review/i.test(statusField.text),
    `and shows what is currently applied (${statusField ? statusField.text : '—'})`);

  await page.click('[data-clients-filter-field="status"]');
  await page.waitForTimeout(700);
  const values = await page.evaluate(() =>
    [...document.querySelectorAll('[data-clients-filter-value]')].map(b =>
      b.innerText.replace(/\s+/g, ' ').trim()));

  EXPECTED.forEach(([label, count]) => {
    check(values.some(v => v.includes(label) && v.includes(String(count))),
      `${label} offered with its count of ${count}`);
  });

  step(6, 'Picking one filters the table');
  const target = await page.evaluate(() => {
    const b = [...document.querySelectorAll('[data-clients-filter-value]')]
      .find(x => x.innerText.includes('Approved'));
    if (b) b.click();
    return !!b;
  });
  check(target, 'Approved is selectable');
  await page.waitForTimeout(3500);
  const approved = await page.evaluate(() => ({
    rows: document.querySelectorAll('.tma-cip-table tbody tr[data-cip-open]').length,
    url: window.location.pathname + window.location.search,
  }));
  check(approved.rows === 7, `the seven Approved applications are listed (${approved.rows})`);
  check(/bucket=approved/.test(approved.url), `the URL followed (${approved.url})`);

  step(7, 'Clearing it brings everything back');
  const cleared = await page.evaluate(() => {
    const x = document.querySelector('[data-clients-chip-remove], [data-clients-filter-clear]');
    if (x) { x.click(); return true; }
    return false;
  });
  if (cleared) {
    await page.waitForTimeout(3500);
    const all = await page.evaluate(() =>
      document.querySelectorAll('.tma-cip-table tbody tr[data-cip-open]').length);
    // 32 in buckets; the draft is the administrator's too, so it is listed
    // even though no bucket counts it.
    check(all > 7, `the filter really lifted (${all} rows)`);
  } else {
    check(false, 'the active status chip has a remove control');
  }

  step(8, 'Nothing broke');
  check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);

  await page.screenshot({ path: 'tests/Browser/cip-buckets.png', fullPage: false });
} catch (e) {
  failures.push(String(e).slice(0, 300));
  await page.screenshot({ path: 'tests/Browser/cip-buckets.png' }).catch(() => {});
} finally {
  console.log(failures.length ? `\nFAILED (${failures.length}):` : '\nPASSED');
  failures.forEach(f => console.log('   ', f));
  await browser.close();
  process.exit(failures.length ? 1 : 0);
}
