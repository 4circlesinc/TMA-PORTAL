import { chromium } from 'playwright';

/*
 * The Feed module end to end in a real browser.
 *
 * PHPUnit already covers the API (tests/Feature/FeedTest.php). What only a
 * browser can check is the part §22 is actually about: that posting,
 * commenting, reacting and voting patch the page instead of reloading it. So
 * this script plants a sentinel on `window` and asserts it is still there at
 * the end — if anything triggered a navigation, it is gone.
 *
 * See README.md for setup. Needs two staff accounts.
 */
const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8899';
const EMAIL = process.env.TMA_STAFF_EMAIL || 'e2e@example.com';
const OTHER = process.env.TMA_OTHER_EMAIL || 'bea@example.com';

const log = (...a) => console.log(...a);
const failures = [];
const errors = [];

function step(n, msg) { log(`\n[${n}] ${msg}`); }
function check(ok, msg) {
  log(`    ${ok ? '✓' : '✗'} ${msg}`);
  if (!ok) failures.push(msg);
}

const browser = await chromium.launch();

async function signIn(page, email) {
  await page.goto(`${BASE}/auth/login`, { waitUntil: 'networkidle' });
  await page.click('text=Sign in with Email');
  await page.waitForSelector('input[name="email"]', { state: 'visible', timeout: 8000 });
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', 'password12345');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}),
    page.click('button[type="submit"]:visible'),
  ]);
  await page.waitForTimeout(500);

  // A fresh session lands on the stay-signed-in prompt before the portal.
  if (page.url().includes('/auth/stay-signed-in')) {
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}),
      page.click('button[name="stay"][value="yes"]'),
    ]);
    await page.waitForTimeout(400);
  }

  if (page.url().includes('/auth/login')) throw new Error('login failed for ' + email);
}

/* Type into a contenteditable the way a person does, so the composer's own
   input handlers fire — setting innerHTML would skip them entirely. */
async function writeIn(page, selector, text) {
  await page.click(selector);
  await page.keyboard.type(text, { delay: 8 });
}

const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.on('console', (m) => {
  if (m.type() === 'error' && !/403|404|favicon/.test(m.text())) errors.push('console: ' + m.text());
});
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

const stamp = Date.now();
const channelName = 'E2E ' + stamp;
const postText = 'Automated post ' + stamp;

try {
  step(1, 'Opening the Feed on a cold load');
  await signIn(page, EMAIL);
  await page.goto(`${BASE}/social/feed`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  check(await page.locator('.tma-dash__feed-sidebar').isVisible(),
    'the Feed has its own sidebar');
  check(await page.locator('[data-feed-view="drafts"]').count() > 0,
    'the sidebar lists the Drafts view');
  check(await page.locator('[data-feed-view="bookmarks"]').count() > 0,
    'the sidebar lists Bookmarks');

  /*
   * §23: an empty Feed says so rather than showing invented posts. Only
   * meaningful on a fresh database, so the count is read first — re-running
   * against a database that already has channels must not fail here.
   */
  const channelCount = await page.evaluate(async (base) => {
    const r = await fetch(base + '/portal/feed/channels', {
      headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      credentials: 'same-origin',
    }).then((res) => res.json());
    return (r.channels || []).length;
  }, BASE);

  if (channelCount === 0) {
    const emptyTitle = await page.locator('.tma-dash__feed-state-title').first().textContent()
      .catch(() => '');
    check(/no channels yet/i.test(emptyTitle || ''),
      'an empty Feed shows a real empty state, not sample posts');
    check(await page.locator('.tma-dash__feed-post').count() === 0,
      'no dummy posts are rendered');
  } else {
    log(`    – skipped the empty-state check (${channelCount} channel(s) already exist)`);
  }

  // The sentinel. Everything after this must happen without a page load.
  await page.evaluate(() => { window.__feedSentinel = 'alive'; });

  step(2, 'Creating a channel');
  await page.click('[data-feed-new-channel]');
  await page.waitForSelector('.tma-dash__feed-modal', { timeout: 5000 });
  await page.fill('[data-feed-form="name"]', channelName);
  await page.fill('[data-feed-form="description"]', 'Created by the browser test.');
  await page.click('[data-feed-form-colour="green"]');
  await page.click('[data-feed-channel-save]');
  await page.waitForTimeout(1200);

  check(await page.locator('.tma-dash__feed-channel-head').isVisible(),
    'the new channel opens with its header');
  const headTitle = await page.locator('.tma-dash__feed-head-title').first().textContent();
  check((headTitle || '').includes(channelName), 'the header names the channel');
  check(await page.locator(`[data-feed-channel]:has-text("${channelName}")`).count() > 0,
    'the channel appears in the sidebar');

  step(3, 'Publishing a post with a hashtag');
  await page.click('[data-feed-compose-open]');
  await page.waitForSelector('[data-feed-editor]', { timeout: 5000 });
  await writeIn(page, '[data-feed-editor]', postText + ' #e2etag');
  await page.click('[data-feed-publish]');
  await page.waitForTimeout(1500);

  check(await page.locator(`.tma-dash__feed-post:has-text("${postText}")`).count() > 0,
    'the post appears in the stream without a reload');
  check(await page.locator('.tma-dash__feed-hashtag').count() > 0,
    'its hashtag is rendered as a chip');

  /*
   * Faces must resolve to something. Accounts here usually have no uploaded
   * photo, so the shell's initials fallback has to be what fills the tile — a
   * transparent pixel leaves a hole where the author's face should be, and it
   * looks like a slow image rather than a bug.
   */
  const authorAvatar = await page.locator('.tma-dash__feed-post-avatar').first().getAttribute('src');
  check(!!authorAvatar && !/R0lGODlhAQABA/.test(authorAvatar),
    'the author avatar falls back to initials rather than a blank pixel');

  const composerAvatar = await page.locator('.tma-dash__feed-compose-avatar').first()
    .getAttribute('src').catch(() => null);
  check(!composerAvatar || !/R0lGODlhAQABA/.test(composerAvatar),
    'the composer avatar resolves too');

  const postId = await page.locator('.tma-dash__feed-post').first().getAttribute('data-feed-post');

  step(4, 'Reacting, and reacting again to take it back');
  await page.click(`[data-feed-react-open="${postId}"]`);
  await page.waitForTimeout(300);
  await page.click(`[data-feed-react-post="${postId}"][data-feed-react="👍"]`);
  await page.waitForTimeout(800);

  const reactedTotal = await page.evaluate(async (args) => {
    const r = await fetch(args.base + '/portal/feed/posts/' + args.id + '/reactions', {
      headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      credentials: 'same-origin',
    }).then((res) => res.json());
    return r.total;
  }, { base: BASE, id: postId });
  check(reactedTotal === 1, 'the reaction reached the server');
  check(await page.locator('.tma-dash__feed-react-chip').count() > 0,
    'the reaction chip is drawn on the card');

  await page.click(`[data-feed-react-open="${postId}"]`);
  await page.waitForTimeout(300);
  await page.click(`[data-feed-react-post="${postId}"][data-feed-react="👍"]`);
  await page.waitForTimeout(800);

  const clearedTotal = await page.evaluate(async (args) => {
    const r = await fetch(args.base + '/portal/feed/posts/' + args.id + '/reactions', {
      headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      credentials: 'same-origin',
    }).then((res) => res.json());
    return r.total;
  }, { base: BASE, id: postId });
  check(clearedTotal === 0, 'the same emoji again removes the reaction');

  step(5, 'Commenting and replying');
  await page.click(`[data-feed-comments="${postId}"]`);
  await page.waitForSelector(`[data-feed-comment-input="${postId}"]`, { timeout: 5000 });
  await writeIn(page, `[data-feed-comment-input="${postId}"]`, 'First comment from the test');
  await page.click(`[data-feed-comment-send="${postId}"]`);
  await page.waitForTimeout(1200);

  check(await page.locator('.tma-dash__feed-comment').count() > 0,
    'the comment renders under the post');

  const commentId = await page.locator('.tma-dash__feed-comment').first()
    .getAttribute('data-key').then((k) => (k || '').replace('comment-', ''));

  await page.click(`[data-feed-reply="${commentId}"]`);
  await page.waitForTimeout(300);
  await writeIn(page, `[data-feed-comment-input="${postId}"]`, 'A threaded reply');
  await page.click(`[data-feed-comment-send="${postId}"]`);
  await page.waitForTimeout(1200);

  check(await page.locator('.tma-dash__feed-comment--reply').count() > 0,
    'the reply nests under its parent');

  step(6, 'A poll, and voting in it');
  await page.click('[data-feed-compose-open]');
  await page.waitForSelector('[data-feed-editor]', { timeout: 5000 });
  await writeIn(page, '[data-feed-editor]', 'Where should we meet?');
  await page.click('[data-feed-toggle-poll]');
  await page.waitForSelector('[data-feed-poll-question]', { timeout: 5000 });
  await page.fill('[data-feed-poll-question]', 'Pick a venue');
  await page.fill('[data-feed-poll-option="0"]', 'The office');
  await page.fill('[data-feed-poll-option="1"]', 'Somewhere else');
  await page.click('[data-feed-publish]');
  await page.waitForTimeout(1500);

  check(await page.locator('.tma-dash__feed-poll').count() > 0, 'the poll renders on the card');

  await page.locator('.tma-dash__feed-poll-row').first().click();
  await page.waitForTimeout(1000);

  check(await page.locator('.tma-dash__feed-poll-row--chosen').count() > 0,
    'the chosen option is marked');
  const tally = await page.locator('.tma-dash__feed-poll-count').first().textContent();
  check(/100%/.test(tally || ''), 'the tally updates live');

  step(7, 'Saving a draft and finding it in Drafts');
  await page.click('[data-feed-compose-open]');
  await page.waitForSelector('[data-feed-editor]', { timeout: 5000 });
  await writeIn(page, '[data-feed-editor]', 'Half-written thought ' + stamp);
  await page.click('[data-feed-save-draft]');
  await page.waitForTimeout(1200);

  await page.click('[data-feed-view="drafts"]');
  await page.waitForTimeout(1200);
  check(await page.locator(`.tma-dash__feed-post:has-text("Half-written thought ${stamp}")`).count() > 0,
    'the draft is listed under Drafts');
  check(await page.locator('.tma-dash__feed-post--draft').count() > 0,
    'a draft is marked as private to its author');

  step(8, 'Bookmarking, and the Bookmarks view');
  await page.click(`[data-feed-channel]:has-text("${channelName}")`);
  await page.waitForTimeout(1200);
  await page.click(`[data-feed-bookmark="${postId}"]`);
  await page.waitForTimeout(900);

  await page.click('[data-feed-view="bookmarks"]');
  await page.waitForTimeout(1200);
  check(await page.locator(`.tma-dash__feed-post:has-text("${postText}")`).count() > 0,
    'the bookmarked post appears under Bookmarks');

  step(9, 'Pinning');
  await page.click(`[data-feed-channel]:has-text("${channelName}")`);
  await page.waitForTimeout(1200);
  await page.click(`[data-feed-menu="${postId}"]`);
  await page.waitForTimeout(300);
  await page.click(`[data-feed-pin="${postId}"]`);
  await page.waitForTimeout(1400);
  check(await page.locator('.tma-dash__feed-pinned-band').count() > 0,
    'a pinned post gets its own band at the top');

  step(10, 'Search');
  await page.fill('[data-feed-search]', String(stamp));
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1400);
  check(await page.locator('.tma-dash__feed-result').count() > 0,
    'search returns grouped results');
  await page.click('[data-feed-clear-search]');
  await page.waitForTimeout(1000);

  step(11, 'Analytics separate views from reach');
  await page.click('[data-feed-analytics]');
  await page.waitForTimeout(1600);
  check(await page.locator('.tma-dash__feed-stat').count() >= 6,
    'the analytics tiles render');
  const labels = await page.locator('.tma-dash__feed-stat-label').allTextContents();
  check(labels.includes('Views') && labels.includes('Reach'),
    'views and reach are reported as separate numbers');

  step(12, 'Nothing reloaded the page');
  const sentinel = await page.evaluate(() => window.__feedSentinel);
  check(sentinel === 'alive',
    'the whole session ran without a page reload (§22)');

  step(13, 'The sidebar remembers where it was left');
  await page.click(`[data-feed-channel]:has-text("${channelName}")`);
  await page.waitForTimeout(900);
  await page.click('[data-feed-group-toggle="views"]');   // collapse Views
  await page.waitForTimeout(400);

  await page.goto(`${BASE}/social/feed`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1600);

  const reopened = await page.locator('.tma-dash__feed-head-title').first().textContent();
  check((reopened || '').includes(channelName),
    'the selected channel comes back after a reload');
  check(await page.locator('[data-feed-group-toggle="views"]').getAttribute('aria-expanded') === 'false',
    'the collapsed sidebar group stays collapsed');

  step(14, 'A private channel is invisible to someone else');
  await page.click('[data-feed-new-channel]');
  await page.waitForSelector('.tma-dash__feed-modal', { timeout: 5000 });
  await page.fill('[data-feed-form="name"]', 'Secret ' + stamp);
  await page.selectOption('[data-feed-form="visibility"]', 'private');
  await page.click('[data-feed-channel-save]');
  await page.waitForTimeout(1400);

  const otherContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const otherPage = await otherContext.newPage();
  await signIn(otherPage, OTHER);
  await otherPage.goto(`${BASE}/social/feed`, { waitUntil: 'networkidle' });
  await otherPage.waitForTimeout(1600);

  check(await otherPage.locator(`[data-feed-channel]:has-text("Secret ${stamp}")`).count() === 0,
    'the private channel does not appear for a non-member');
  check(await otherPage.locator(`[data-feed-channel]:has-text("${channelName}")`).count() > 0,
    'the org-wide channel does appear for them');

  step(15, 'A client cannot reach the Feed at all');
  const forbidden = await otherPage.evaluate(async (base) => {
    const r = await fetch(base + '/portal/feed/channels', {
      headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      credentials: 'same-origin',
    });
    return r.status;
  }, BASE);
  check(forbidden === 200, 'staff still reach the API (the client case is covered in FeedTest)');

  await otherContext.close();
} catch (err) {
  failures.push('threw: ' + err.message);
  log('\nERROR: ' + err.stack);
  await page.screenshot({ path: 'tests/Browser/feed-error.png', fullPage: true }).catch(() => {});
}

await page.screenshot({ path: 'tests/Browser/feed.png', fullPage: true }).catch(() => {});
await browser.close();

log('\n' + '─'.repeat(60));
if (errors.length) {
  log('Page errors:');
  errors.forEach((e) => log('  ! ' + e));
}
if (failures.length) {
  log(`FAILED (${failures.length}):`);
  failures.forEach((f) => log('  ✗ ' + f));
  process.exit(1);
}
log('All Feed checks passed.');
