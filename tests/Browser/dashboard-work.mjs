/* The Requests and Comments tiles on the portal home. */
import { chromium } from 'playwright';

const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8899';
const SHOT = process.argv[2];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 1200 } });

const IGNORE = /Origin not allowed|realtime disabled|Failed to load resource/;
const errors = [];
const note = (t) => { if (!IGNORE.test(t)) errors.push(t); };
page.on('pageerror', (e) => note(String(e)));
page.on('console', (m) => { if (m.type() === 'error') note(m.text()); });

await page.goto(`${BASE}/auth/login`, { waitUntil: 'networkidle' });
await page.click('text=Sign in with Email');
await page.waitForSelector('input[name="email"]', { state: 'visible', timeout: 8000 });
await page.fill('input[name="email"]', 'e2e@example.com');
await page.fill('input[name="password"]', 'password12345');
await Promise.all([
  page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}),
  page.click('button[type="submit"]:visible'),
]);
if (page.url().includes('/auth/login')) throw new Error('login failed');

// Signing in lands on the trust-this-device interstitial, not the portal.
if (page.url().includes('/auth/stay-signed-in')) {
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}),
    page.click('button:has-text("Yes")'),
  ]);
  await page.waitForTimeout(500);
}

await page.waitForSelector('[data-tile-id="requests"]', { timeout: 30000 });
await page.waitForSelector('[data-tile-id="comments"]', { timeout: 30000 });
await page.waitForSelector('.tma-portal-request-row', { timeout: 30000 });
await page.waitForSelector('.tma-portal-comment-row', { timeout: 30000 });
await page.waitForSelector('[data-home-wf-strip-root]', { timeout: 30000 });
await page.waitForTimeout(1200);

const read = async (sel, shape) => page.$$eval(sel, shape);

const requests = await read('[data-tile-id="requests"] .tma-portal-request-row', (ns) =>
  ns.map((n) => ({
    type: n.querySelector('.tma-portal-request-row__type')?.textContent?.trim(),
    time: n.querySelector('.tma-portal-request-row__time')?.textContent?.trim(),
    file: n.querySelector('.tma-portal-request-row__file')?.textContent?.trim(),
    headline: n.querySelector('.tma-portal-request-row__headline')?.textContent?.trim(),
    tone: n.querySelector('[class*="__headline--"]')?.className.match(/headline--(\w+)/)?.[1] || null,
    colour: getComputedStyle(n.querySelector('.tma-portal-request-row__headline')).color,
    avatar: !!n.querySelector('.tma-portal-request-row__avatar')?.getAttribute('src'),
    file_attr: n.getAttribute('data-home-work-file'),
  }))
);

const readComments = () => read('[data-tile-id="comments"] .tma-portal-comment-row', (ns) =>
  ns.map((n) => ({
    author: n.querySelector('.tma-portal-comment-row__author')?.textContent?.trim(),
    time: n.querySelector('.tma-portal-comment-row__time')?.textContent?.trim(),
    body: n.querySelector('.tma-portal-comment-row__body')?.textContent?.trim(),
    file: n.querySelector('.tma-portal-comment-row__file')?.textContent?.trim(),
    unread: n.classList.contains('is-unread'),
    dot: !!n.querySelector('.tma-portal-comment-row__unread'),
    weight: getComputedStyle(n.querySelector('.tma-portal-comment-row__body')).fontWeight,
    colour: getComputedStyle(n.querySelector('.tma-portal-comment-row__body')).color,
    file_attr: n.getAttribute('data-home-work-file'),
    id: n.getAttribute('data-home-work-comment'),
  }))
);

const comments = await readComments();

const heads = await page.$$eval('[data-tile-id="requests"], [data-tile-id="comments"]', (ns) =>
  ns.map((n) => ({
    id: n.getAttribute('data-tile-id'),
    title: n.querySelector('.tma-portal-panel__title')?.textContent?.trim(),
    meta: n.querySelector('.tma-portal-panel__meta')?.textContent?.trim() || null,
    busy: n.getAttribute('aria-busy'),
    box: n.getBoundingClientRect().toJSON(),
  }))
);

console.log(JSON.stringify({ heads, requests, comments }, null, 2));

/* The sidebar badge must agree with what the tiles say — the board publishes
   the counts it was handed, so a stale badge beside a fresh tile is a bug the
   reader can see. With the group collapsed the number sits on the group row;
   the two nested rows carry it only while the group is open. */
const groupBadge = await page.$eval('.tma-dash__nav-item[data-expand="workflows"]',
  (n) => n.querySelector('.tma-dash__nav-count')?.textContent?.trim() || '');
console.log('workflows badge:', JSON.stringify(groupBadge));

// Reading the tile must not clear the unread count.
const before = await page.evaluate(async () => (await (await fetch('/portal/files/workflows/counts', { headers: { Accept: 'application/json' } })).json()).counts);
await page.evaluate(async () => { await fetch('/portal/dashboard/work', { headers: { Accept: 'application/json' } }); });
const after = await page.evaluate(async () => (await (await fetch('/portal/files/workflows/counts', { headers: { Accept: 'application/json' } })).json()).counts);
console.log('unread before/after a tile refresh:', before.unread, '/', after.unread);

if (SHOT) await page.screenshot({ path: SHOT, fullPage: true });

const fail = [];
if (!requests.length) fail.push('no request rows');
if (!comments.length) fail.push('no comment rows');
const stripCards = await page.$$eval('[data-home-wf-strip-root] .tma-portal-wf-card', (ns) => ns.length);
if (!stripCards) fail.push('no workflow strip cards above the KPIs');
if (stripCards > 10) fail.push(`workflow strip shows ${stripCards} cards, cap is 10`);
for (const r of requests) {
  if (!r.file) fail.push('request row with no file');
  if (!r.headline) fail.push('request row with no headline');
  if (!r.time) fail.push('request row with no time');
  if (!r.file_attr) fail.push('request row is not clickable');
}
for (const c of comments) {
  if (!c.body) fail.push('comment row with no body');
  if (!c.author) fail.push('comment row with no author');
  if (!c.file_attr) fail.push('comment row is not clickable');
  // The dot is the state's one carrier for a row whose body is too short to
  // show any weight at all, so it has to track the class, not decorate it.
  if (c.unread !== c.dot) fail.push(`row "${c.body}" is unread=${c.unread} but dot=${c.dot}`);
}

/*
 * Read and unread have to be *visibly* different, which is the whole ask.
 * Compared as computed style rather than class names: a rule the cascade
 * overrides later leaves the class on and the difference off, and that failure
 * is invisible to any test that only reads markup.
 *
 * The body colour is deliberately NOT part of the difference — both states are
 * black, so that a read row still tells the comment apart from the filename
 * under it. Checked here so nobody restores the fade thinking it was missing.
 */
{
  const unread = comments.filter((c) => c.unread);
  const alreadyRead = comments.filter((c) => !c.unread);
  if (!unread.length) fail.push('no unread rows to compare — re-seed');
  if (!alreadyRead.length) fail.push('no read rows to compare — open one first');
  if (unread.length && alreadyRead.length) {
    if (unread[0].weight === alreadyRead[0].weight) {
      fail.push(`read and unread are the same weight (${unread[0].weight})`);
    }
    if (unread[0].colour !== alreadyRead[0].colour) {
      fail.push(`a read comment was faded (${alreadyRead[0].colour}) — it must stay as readable as an unread one`);
    }
    const fileColour = await page.$eval('[data-tile-id="comments"] .tma-portal-comment-row__file',
      (n) => getComputedStyle(n).color);
    if (alreadyRead[0].colour === fileColour) {
      fail.push('a read comment is the same colour as the filename under it');
    }
  }
}
if (after.unread !== before.unread) fail.push(`tile refresh changed unread ${before.unread} -> ${after.unread}`);
if (Number(groupBadge) !== before.waiting + before.unread) {
  fail.push(`sidebar badge says ${groupBadge}, tiles say ${before.waiting} + ${before.unread}`);
}
for (const h of heads) if (h.busy === 'true') fail.push(`${h.id} still shows a skeleton`);

/*
 * Opening a thread reads it — and the row has to say so on the way back,
 * not on the next poll. Marked through the same endpoint the Workflows page
 * uses, then the board is re-asked the way its own timer would.
 */
{
  const target = comments.find((c) => c.unread);
  if (target) {
    await page.evaluate(async (id) => {
      const m = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);
      await fetch(`/portal/files/workflows/comments/${id}/read`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
          'X-XSRF-TOKEN': m ? decodeURIComponent(m[1]) : '',
        },
      });
    }, target.id);

    // The board polls; force the same read rather than waiting a minute for it.
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('tma-workflow-counts', { detail: {} })));
    await page.waitForTimeout(2000);

    const after = (await readComments()).find((c) => c.id === target.id);
    if (!after) fail.push('the row vanished once it was read');
    else if (after.unread) fail.push(`"${after.body}" was read but still draws as unread`);
  }
}

/*
 * Clicking a comment opens the file it is about — and that click is also the
 * reading, so the row has to come back read.
 *
 * Asserted on the outcome rather than the mechanism, because two things can
 * produce it: the tile posts the mark itself (with `keepalive`, since the same
 * click navigates away and an ordinary fetch would be cancelled on the way
 * out), and the file's own comments panel marks its threads read once it
 * loads. Either is a correct answer to "did opening it read it"; a row still
 * bold after you have been and looked at it is not.
 *
 * The reload matters: the tile turns the row grey optimistically, so a dropped
 * mark looks identical until you come back.
 */
const clicked = (await readComments()).find((c) => c.unread) || (await readComments())[0];
await page.click(`[data-home-work-comment="${clicked.id}"]`);
await page.waitForTimeout(2500);
const url = page.url();
console.log('after clicking a comment:', url);
if (!url.includes('/folders/all?') || !url.includes('file=')) fail.push(`comment click went to ${url}`);

await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
await page.waitForSelector('.tma-portal-comment-row');
await page.waitForTimeout(2000);
const back = (await readComments()).find((c) => c.id === clicked.id);
console.log('the clicked row, on the way back:', back && { unread: back.unread, weight: back.weight });
if (!back) fail.push('the clicked row was gone on the way back');
else if (back.unread) fail.push('opening a comment did not mark it read — the keepalive mark was dropped');

if (errors.length) fail.push(`console errors: ${errors.join(' | ')}`);
console.log(fail.length ? 'FAIL\n' + fail.join('\n') : 'PASS');
await browser.close();
process.exit(fail.length ? 1 : 0);
