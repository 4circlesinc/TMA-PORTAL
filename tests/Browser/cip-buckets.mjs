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
 * The card is one stacked bar over a legend, so this seed — every bucket busy
 * — is deliberately the case where the bar has to divide into ten and still
 * come out to exactly its own width. What happens when a stage empties is
 * checked in step 1b by emptying the card's data rather than by seeding a
 * second book.
 */
const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8899';
const EMAIL = process.env.TMA_STAFF_EMAIL || 'e2e@example.com';
const PASSWORD = process.env.TMA_STAFF_PASSWORD || 'password12345';

/**
 * What the harness seeded, in the order §9 names them: the full label, the
 * short one the card's legend uses, and the count.
 *
 * Both names are here because both are the server's — App\Support\Cip\Buckets
 * names each bucket twice, so that a legend column can hold "Requests" while
 * the thing it opens is still Additional Information Requests. A browser
 * shortening the label by rule is the failure this guards.
 *
 * The percentages are what the legend prints, and they are stated here rather
 * than computed from the counts on purpose: a test that divides by 32 the same
 * way the page does agrees with the page whichever of them is wrong. These are
 * the ten shares of 32, and they add up to 100.
 */
const EXPECTED = [
  ['New Applications', 'New', 3, '9%'],
  ['Review Applications', 'Review', 1, '3%'],
  ['Assessment Feedback', 'Feedback', 4, '13%'],
  ['Updates Required', 'Updates', 2, '6%'],
  ['Ready to Submit', 'Ready', 5, '16%'],
  ['Pending Review', 'Pending', 6, '19%'],
  ['Background Check', 'Background', 1, '3%'],
  ['Delayed', 'Delayed', 2, '6%'],
  ['Approved', 'Approved', 7, '22%'],
  ['Denied', 'Denied', 1, '3%'],
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
    await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}), page.click('button[type="submit"]:visible')]);
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
      full: li.querySelector('[data-home-cip-bucket]')?.getAttribute('title') || '',
      share: li.querySelector('.tma-portal-cip__share')?.innerText.trim() || '',
      // The tone lives on the row: the dot and the bar's block both read it,
      // and a colour named twice is a colour that can disagree with itself.
      tone: [...li.classList].find(c => c.startsWith('tma-portal-cip__tone--')) || '',
    })));

  check(rows.length === EXPECTED.length, `${EXPECTED.length} legend rows (${rows.length})`);
  EXPECTED.forEach(([label, short, count, share], i) => {
    const row = rows[i] || {};
    check(row.label === short && row.share === share,
      `${short} = ${share} (got "${row.label}" = "${row.share}")`);
    /*
     * The legend prints the share; the count and the full name are on the
     * control itself. Both halves matter: "Requests" alone does not tell
     * anybody what they are, and a card that had dropped the exact number
     * everywhere would have replaced a figure with an estimate of it.
     */
    check(row.full === `${label}: ${count} (${share})`,
      `and carries ${label}: ${count} (${share}) in full (got "${row.full}")`);
  });
  check(
    EXPECTED.reduce((t, [, , , share]) => t + parseInt(share, 10), 0) === 100,
    'the shares this seed prints add up to 100',
  );
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
   * The bar. What is really being checked is that it is a *whole*: ten blocks
   * whose widths and gaps come to exactly the width of the strip, in the same
   * order as the legend. A bar that overflowed, left a gap at the end, or
   * ordered itself differently from the names under it would be a picture of
   * a pipeline nobody has.
   */
  const bar = await page.evaluate(() => {
    const card = document.querySelector('[data-tile-id="cipStatus"]');
    const stack = card.querySelector('.tma-portal-cip__stack');
    const segs = [...stack.querySelectorAll('.tma-portal-cip__seg')];
    const w = el => el.getBoundingClientRect().width;
    return {
      n: segs.length,
      keys: segs.map(s => s.getAttribute('data-home-cip-bucket')),
      named: segs.filter(s => (s.getAttribute('aria-label') || '').trim()).length,
      filled: segs.filter(s => {
        const bg = getComputedStyle(s).backgroundColor;
        return bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent';
      }).length,
      numbered: segs.filter(s => s.innerText.trim()).length,
      smallest: Math.min(...segs.map(w)),
      // Widths plus the 3px gaps between them, against the strip itself.
      spans: Math.round(segs.reduce((t, s) => t + w(s), 0) + 3 * (segs.length - 1)),
      strip: Math.round(w(stack)),
      // The widest block must be the biggest count — 7 Approved here — or the
      // shares have been computed against something other than the total.
      widest: segs[segs.map(w).indexOf(Math.max(...segs.map(w)))].getAttribute('data-home-cip-bucket'),
      overflow: card.scrollWidth - card.clientWidth,
    };
  });
  check(bar.n === EXPECTED.length, `${EXPECTED.length} blocks (${bar.n})`);
  check(bar.keys.join() === rows.map(r => r.key).join(), 'in the same order as the legend');
  check(bar.named === bar.n, `every block says what it is (${bar.named}/${bar.n})`);
  check(bar.filled === bar.n, `and every one is painted (${bar.filled}/${bar.n})`);
  check(bar.spans === bar.strip, `the blocks fill the strip exactly (${bar.spans} of ${bar.strip})`);
  check(bar.smallest >= 20, `the smallest share is still hittable (${bar.smallest}px)`);
  check(bar.widest === 'approved', `the widest block is the biggest count (${bar.widest})`);
  check(bar.numbered > 0 && bar.numbered < bar.n,
    `only the blocks wide enough carry their number (${bar.numbered} of ${bar.n})`);
  check(bar.overflow === 0, `and the card does not scroll sideways (${bar.overflow}px)`);

  /*
   * The figure the bar is a hundred per cent of, which lives in the heading
   * beside the card's name. 32 across the ten buckets, and the DRAFT is the
   * evidence: it is the administrator's application too, so a total that
   * counted the book rather than the buckets would read 33.
   *
   * The heading is checked whole, because the point of moving the number up
   * there was that one line carries both the name and the count — a card that
   * printed the total twice, or lost the name to make room, would pass a
   * check that only read the number.
   */
  const heading = await page.evaluate(() => {
    const card = document.querySelector('[data-tile-id="cipStatus"]');
    return {
      text: card.querySelector('.tma-portal-panel__head')?.innerText.replace(/\s+/g, ' ').trim() || '',
      elsewhere: card.querySelectorAll('.tma-portal-cip__total').length,
    };
  });
  check(heading.text === 'CIP Applications 32', `the heading carries the total (got "${heading.text}")`);
  check(heading.elsewhere === 0, 'and nothing under it prints the same number again');

  // Every bucket is busy in this seed, so nothing is a chip.
  const cardChips = await page.$$('[data-tile-id="cipStatus"] .tma-portal-cip__chip');
  check(cardChips.length === 0, `no chips when every stage has work (${cardChips.length})`);

  step('1b', 'A stage sitting at zero becomes a chip and keeps its press');
  /*
   * Driven through the card's own data rather than a second seeded book: which
   * stages get a block is a property of the render, and re-seeding ten statuses
   * to prove it would test the fixture. The dashboard endpoint is answered
   * with the real payload minus most of its counts, then the card repaints.
   */
  await page.route('**/portal/cip/dashboard', async route => {
    const res = await route.fetch();
    const body = await res.json();
    body.buckets = body.buckets.map((b, i) => (i === 4 ? b : { ...b, count: 0 }));
    body.total = body.buckets[4].count;
    await route.fulfill({ response: res, json: body });
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-tile-id="cipStatus"] .tma-portal-cip__chip', { timeout: 60000 });
  await page.waitForTimeout(1500);

  const quiet = await page.evaluate(() => {
    const card = document.querySelector('[data-tile-id="cipStatus"]');
    const segs = [...card.querySelectorAll('.tma-portal-cip__seg')];
    const stack = card.querySelector('.tma-portal-cip__stack');
    return {
      segs: segs.length,
      rows: card.querySelectorAll('.tma-portal-cip__row').length,
      chips: card.querySelectorAll('.tma-portal-cip__chip').length,
      // One stage holding everything is one block across the whole strip.
      whole: segs.length === 1 &&
        Math.abs(segs[0].getBoundingClientRect().width - stack.getBoundingClientRect().width) < 1,
      total: card.querySelector('.tma-portal-panel__meta')?.innerText.trim() || '',
      share: card.querySelector('.tma-portal-cip__share')?.innerText.trim() || '',
    };
  });
  check(quiet.segs === 1, `only the stage holding work gets a block (${quiet.segs})`);
  check(quiet.whole, 'and it is the whole bar');
  check(quiet.rows === 1, `one legend row (${quiet.rows})`);
  check(quiet.chips === EXPECTED.length - 1, `the other nine are chips (${quiet.chips})`);
  check(quiet.total === '5', `the total is what the one stage holds (got "${quiet.total}")`);
  // The one stage holding everything is all of it, and the legend says so.
  check(quiet.share === '100%', `and its share is 100% (got "${quiet.share}")`);

  // A stage with nothing in it is still openable — through its chip, which is
  // the whole reason the chips are buttons.
  await page.click('[data-tile-id="cipStatus"] .tma-portal-cip__chip[data-home-cip-bucket="denied"]');
  await page.waitForTimeout(3000);
  check(/bucket=denied/.test(page.url()), `an empty stage still opens its list (${page.url()})`);

  await page.unroute('**/portal/cip/dashboard');
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-tile-id="cipStatus"] .tma-portal-cip__row', { timeout: 60000 });
  await page.waitForTimeout(1500);

  /* ── The card opens the table, filtered ────────── */

  step(2, 'A row opens the applications table filtered to that bucket');
  // Scoped to the legend row on purpose: three controls now carry this bucket
  // — its block in the bar, its legend row, and (when it empties) its chip —
  // and an unscoped selector matches more than one, which Playwright refuses.
  await page.click('[data-tile-id="cipStatus"] .tma-portal-cip__link[data-home-cip-bucket="pending_review"]');
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

  EXPECTED.forEach(([label, , count]) => {
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
