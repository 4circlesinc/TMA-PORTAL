/*
 * The Client hub's split view: list column beside the client's profile.
 *
 * Four things that are only true on screen:
 *
 * 1. The gutter between the two panes. The page put its own 28px gap either
 *    side of the drag handle, so the panes sat 40px apart with a hole down the
 *    middle of the page.
 * 2. The list's default width, and that the handle can still take it below.
 * 3. The letter headings stick as you scroll, and exactly one is pinned at a
 *    time — flat sticky siblings all pin to the same line and stack there,
 *    which reads correctly by accident and is wrong underneath.
 * 4. The Documents and Assigned tabs carry counts, and carry them before
 *    either tab has been opened.
 */
import { chromium } from 'playwright';

const BASE = process.env.TMA_BASE || 'http://127.0.0.1:8912';
const DIR_DEFAULT = 291;

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1500, height: 950 } });
const page = await context.newPage();
const failures = [];

function check(name, ok, detail) {
  if (ok) console.log(`  ok   ${name}`);
  else {
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
    failures.push(name);
  }
}

await page.goto(`${BASE}/auth/login`, { waitUntil: 'domcontentloaded' });
await page.click('text=Sign in with Email');
await page.waitForSelector('input[name="email"]', { state: 'visible', timeout: 8000 });
await page.fill('input[name="email"]', 'e2e@example.com');
await page.fill('input[name="password"]', 'password12345');
await Promise.all([
  page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}),
  page.click('button[type="submit"]:visible'),
]);
if (page.url().includes('/auth/stay-signed-in')) {
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}),
    page.click('button[type="submit"]:visible'),
  ]);
}
await page.waitForSelector('[data-expand="folders"]', { timeout: 20000 });
await page.waitForTimeout(1500);
// The hover-overlay sidebar expands over the left strip; park the pointer away.
await page.mouse.move(1400, 500);

await page.click('[data-nav="clients"]');
await page.waitForTimeout(3000);
// The split view is the page toggle's grid mode.
await page.click('[data-page-view-toggle] [data-view-mode="grid"]');
await page.waitForTimeout(2500);

/* ── 1 + 2. the gutter and the default width ─────── */
function geometry() {
  return page.evaluate(() => {
    const page_ = document.querySelector('.tma-dash__clients-page');
    const dir = page_.querySelector('.tma-dash__clients-directory');
    const det = page_.querySelector('.tma-dash__clients-detail');
    const rez = page_.querySelector('[data-clients-resizer]');
    return {
      dirW: Math.round(dir.getBoundingClientRect().width),
      gutter: Math.round(det.getBoundingClientRect().left - dir.getBoundingClientRect().right),
      handleW: Math.round(rez.getBoundingClientRect().width),
    };
  });
}

const geo = await geometry();
check('the list opens at the wider default', geo.dirW === DIR_DEFAULT, `${geo.dirW}px`);
check('the gutter between the panes is tight', geo.gutter <= 20, `${geo.gutter}px`);
check('the drag handle fills the gutter', geo.handleW === geo.gutter, `${geo.handleW} vs ${geo.gutter}`);

// The handle's grab area is wider than the gutter it draws, so it stays easy
// to hit — the pseudo-element extends it either side.
check(
  'the handle is easy to grab',
  await page.evaluate(() => {
    const r = document.querySelector('[data-clients-resizer]').getBoundingClientRect();
    const hit = document.elementFromPoint(Math.round(r.left) - 4, Math.round(r.top + r.height / 2));
    return !!(hit && hit.closest('[data-clients-resizer]'));
  })
);

/* Dragging must still be able to take the list below the new default. */
const handle = await page.evaluate(() => {
  const r = document.querySelector('[data-clients-resizer]').getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
});
await page.mouse.move(handle.x, handle.y);
await page.mouse.down();
await page.mouse.move(handle.x - 70, handle.y, { steps: 10 });
await page.mouse.up();
await page.waitForTimeout(500);
const narrowed = await geometry();
check(
  'the handle can take the list below the default',
  narrowed.dirW < DIR_DEFAULT - 40,
  `${narrowed.dirW}px`
);
check('the gutter holds while resizing', narrowed.gutter === geo.gutter, `${narrowed.gutter}px`);

// Put it back so the rest of the run reads the real default.
await page.mouse.move(handle.x - 70, handle.y);
await page.mouse.down();
await page.mouse.move(handle.x, handle.y, { steps: 10 });
await page.mouse.up();
await page.waitForTimeout(400);

/* ── 3. the letter headings stick ────────────────── */
async function stuckAt(scrollTop) {
  return page.evaluate((t) => {
    const body = document.querySelector('.tma-dash__clients-directory-body');
    body.scrollTop = t;
    const top = body.getBoundingClientRect().top;
    return [...body.querySelectorAll('.tma-dash__clients-letter')]
      .filter((el) => Math.abs(el.getBoundingClientRect().top - top) < 1.5)
      .map((el) => el.textContent.trim());
  }, scrollTop);
}

check(
  'a letter heading is pinned while scrolling its group',
  (await stuckAt(0)).length === 1 && (await stuckAt(460)).length === 1,
  JSON.stringify(await stuckAt(460))
);
check(
  'headings hand over rather than stacking up',
  (await Promise.all([200, 460, 900].map(stuckAt))).every((s) => s.length <= 1),
  JSON.stringify(await Promise.all([200, 460, 900].map(stuckAt)))
);
// The pinned letter is the group actually on screen, not the first one.
const deep = await stuckAt(900);
check('the pinned letter is the group in view', deep[0] && deep[0] !== 'A', JSON.stringify(deep));

await page.evaluate(() => { document.querySelector('.tma-dash__clients-directory-body').scrollTop = 0; });
await page.waitForTimeout(300);

/* ── 4. counts on the profile tabs ───────────────── */
// A client seeded with documents and assigned staff (see the seed at the end
// of the README) — addressed by name, never by row position.
await page.click('.tma-dash__clients-row:has-text("Amara Okafor")');
await page.waitForTimeout(4000);

const tabs = await page.evaluate(() => {
  const out = {};
  document.querySelectorAll('[data-clients-tab]').forEach((btn) => {
    const chip = btn.querySelector('.tma-tab__count');
    out[btn.getAttribute('data-clients-tab')] = chip ? chip.textContent.trim() : null;
  });
  return out;
});

check('the Documents tab carries a count', tabs.folders === '5', JSON.stringify(tabs));
check('the Assigned tab carries a count', tabs.assigned === '2', JSON.stringify(tabs));
check(
  'the counts are there before either tab is opened',
  await page.evaluate(() =>
    document.querySelector('[data-clients-tab="info"]').getAttribute('aria-selected') === 'true')
);
check('tabs with nothing to count stay bare', tabs.info === null && tabs.access === null, JSON.stringify(tabs));

// Drilling into a subfolder must not rewrite the client's total.
await page.click('[data-clients-tab="folders"]');
await page.waitForTimeout(2500);
// A double-click drills in; a single click only picks the tile, the way a
// folder window works.
await page.dblclick('.tma-dash__clients-folder[data-clients-subfolder]');
await page.waitForTimeout(2500);
check(
  'drilling into a subfolder leaves the total alone',
  await page.evaluate(() =>
    document.querySelector('[data-clients-tab="folders"] .tma-tab__count').textContent.trim() === '5'),
  await page.evaluate(() => {
    const c = document.querySelector('[data-clients-tab="folders"] .tma-tab__count');
    return c ? c.textContent.trim() : 'gone';
  })
);

await page.screenshot({ path: 'tests/Browser/clients-split-view.png' });

/* ── 5. the same counts in the full-page table flow ── */
// The page's other layout renders the profile from the same function, so a
// signature change there must not leave one of the two without its counts.
await page.click('[data-page-view-toggle] [data-view-mode="list"]');
await page.waitForTimeout(2500);
await page.click('.tma-dash__ctr--body:has-text("Amara Okafor")');
await page.waitForTimeout(4000);
check(
  'the table flow shows the counts too',
  await page.evaluate(() => {
    const doc = document.querySelector('[data-clients-tab="folders"] .tma-tab__count');
    const asg = document.querySelector('[data-clients-tab="assigned"] .tma-tab__count');
    return !!doc && !!asg && doc.textContent.trim() === '5' && asg.textContent.trim() === '2';
  }),
  await page.evaluate(() => [...document.querySelectorAll('[data-clients-tab] .tma-tab__label')].map(l => l.textContent.trim()).join(' | '))
);

await browser.close();

if (failures.length) {
  console.error(`\n${failures.length} failure(s): ${failures.join(', ')}`);
  process.exit(1);
}
console.log('\nall checks passed');
