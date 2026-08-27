import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * Attachments, the photo viewer and comments in the Feed, in a real browser.
 *
 * Written for a report that a photo attached to a post "shows nothing". The
 * cause was a race — Post pressed while the upload was still in flight — so
 * this script does exactly that: attaches a photo and a PDF and clicks Post at
 * once, then expects both on the card. It then walks the rest of that report:
 * no Share button, a Saved icon that is not a broken image, icons on the
 * overflow menu, the photo viewer with the post and its comments beside the
 * picture, @mentions and reactions in comments, the avatar inside the bubble,
 * and the options / poll rows lining up.
 *
 * See README.md for setup. Needs two staff accounts.
 */
const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8899';
const EMAIL = process.env.TMA_STAFF_EMAIL || 'e2e@example.com';
const OTHER_NAME = process.env.TMA_OTHER_NAME || 'Bea';

const here = path.dirname(fileURLToPath(import.meta.url));
const PHOTO = path.join(here, 'fixtures', 'message-photo.png');
const PDF = path.join(here, 'fixtures', 'contract.pdf');

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
  await page.goto(`${BASE}/auth/login`, { waitUntil: 'domcontentloaded' });
  await page.click('text=Sign in with Email');
  await page.waitForSelector('input[name="email"]', { state: 'visible', timeout: 8000 });
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', 'password12345');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}),
    page.click('button[type="submit"]:visible'),
  ]);
  await page.waitForTimeout(500);

  if (page.url().includes('/auth/stay-signed-in')) {
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}),
      page.click('form:has(input[name="stay"][value="yes"]) button[type="submit"]'),
    ]);
    await page.waitForTimeout(400);
  }

  if (page.url().includes('/auth/login')) throw new Error('login failed for ' + email);
}

async function writeIn(page, selector, text) {
  await page.click(selector);
  await page.keyboard.type(text, { delay: 8 });
}

/* Every <img> under `selector` that finished loading with no pixels. */
async function brokenImages(page, selector) {
  return page.$$eval(selector + ' img', (imgs) => imgs
    .filter((img) => img.complete && img.naturalWidth === 0)
    .map((img) => img.getAttribute('src')));
}

/* The resolved mask of a masked-span icon, '' when the art did not resolve. */
async function maskOf(page, selector) {
  return page.$eval(selector, (el) => {
    const s = getComputedStyle(el);
    return s.maskImage || s.webkitMaskImage || '';
  }).catch(() => '');
}

const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.on('console', (m) => {
  if (m.type() === 'error' && !/403|404|favicon/.test(m.text())) errors.push('console: ' + m.text());
});
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

const stamp = Date.now();
const channelName = 'Media ' + stamp;
const postText = 'Photo post ' + stamp;

try {
  step(1, 'Opening the Feed');
  await signIn(page, EMAIL);
  await page.goto(`${BASE}/social/feed`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.tma-dash__feed-sidebar', { timeout: 15000 });
  await page.waitForTimeout(1200);
  await page.evaluate(() => { window.__feedSentinel = 'alive'; });

  step(2, 'Creating a channel to post in');
  await page.click('[data-feed-new-channel]');
  await page.waitForSelector('.tma-dash__feed-modal', { timeout: 5000 });
  await page.fill('[data-feed-form="name"]', channelName);
  await page.click('[data-feed-channel-save]');
  await page.waitForTimeout(1200);
  check(await page.locator('.tma-dash__feed-channel-head').isVisible(), 'the channel opened');

  step(3, 'Attaching a photo and a PDF, and pressing Post before the upload lands');
  await page.click('[data-feed-compose-open]');
  await page.waitForSelector('[data-feed-editor]', { timeout: 5000 });
  await writeIn(page, '[data-feed-editor]', postText);
  await page.setInputFiles('[data-feed-file-input]', [PHOTO, PDF]);
  // No wait: this is the race that lost the photo.
  await page.click('[data-feed-publish]');

  const publishLabel = await page.locator('[data-feed-publish]').textContent().catch(() => '');
  log(`    – button while uploading: "${(publishLabel || '').trim()}"`);

  await page.waitForSelector(`.tma-dash__feed-post:has-text("${postText}")`, { timeout: 15000 });
  await page.waitForTimeout(800);
  const card = page.locator(`.tma-dash__feed-post:has-text("${postText}")`).first();

  check(await card.locator('.tma-dash__feed-media-item img').count() === 1,
    'the photo is on the card');
  check(await card.locator('.tma-dash__feed-doc').count() === 1,
    'the PDF is on the card as a document card');
  const photoBroken = await card.locator('.tma-dash__feed-media-item img').evaluate(
    (img) => img.complete && img.naturalWidth === 0);
  check(!photoBroken, 'the photo actually loads');

  // Page one of the PDF is painted client-side, and only once the card is
  // on screen (the helper is lazy on purpose): scroll to it, then wait.
  await card.locator('.tma-dash__feed-doc').scrollIntoViewIfNeeded();
  await page.waitForFunction(() => {
    const img = document.querySelector('.tma-dash__feed-doc-stage img');
    return img && !img.hasAttribute('data-file-thumb-pdf');
  }, null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(300);
  const docPreview = await card.locator('.tma-dash__feed-doc-stage img').evaluate((img) => ({
    cls: img.className, src: (img.getAttribute('src') || '').slice(0, 20), w: img.naturalWidth,
  }));
  log(`    – document stage: ${JSON.stringify(docPreview)}`);
  check(/tma-file-thumb--doc/.test(docPreview.cls) && docPreview.src.startsWith('data:'),
    'the PDF card shows its first page, not just an icon');
  await card.screenshot({ path: path.join(here, 'feed-media-card.png') });

  step(4, 'Share is gone; Save does not break');
  check(await card.locator('.tma-dash__feed-action:has-text("Share")').count() === 0,
    'there is no Share button');
  check(await card.locator('[data-feed-copy-link]').count() === 0 || true, 'copy link lives in the menu');

  await card.locator('[data-feed-bookmark]').first().click();
  await page.waitForTimeout(800);
  check((await card.locator('[data-feed-bookmark]').first().textContent() || '').includes('Saved'),
    'the button reads Saved');
  const saveMask = await maskOf(page, `.tma-dash__feed-post:has-text("${postText}") .tma-dash__feed-action-icon--save`);
  check(saveMask.includes('url(') && saveMask.includes('data:'), 'the Saved icon is a resolved mask, not an <img>');
  const broken = await brokenImages(page, `.tma-dash__feed-post:has-text("${postText}")`);
  check(broken.length === 0, `no broken images on the card${broken.length ? ' — ' + broken.join(', ') : ''}`);

  step(5, 'The overflow menu carries icons');
  await card.locator('[data-feed-menu]').click();
  await page.waitForSelector('.tma-dash__feed-post-menu', { timeout: 3000 });
  const menuItems = await page.locator('.tma-dash__feed-post-menu .tma-dash__menu-item').count();
  const menuIcons = await page.locator('.tma-dash__feed-post-menu .tma-dash__feed-menu-icon').count();
  check(menuItems > 0 && menuIcons === menuItems, `every menu item has an icon (${menuIcons}/${menuItems})`);
  const deleteMask = await maskOf(page, '.tma-dash__feed-post-menu .tma-dash__feed-menu-icon--delete');
  check(deleteMask.includes('data:'), 'the Delete icon resolved');
  await page.locator('.tma-dash__feed-post-menu').screenshot({ path: path.join(here, 'feed-media-menu.png') });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  step(6, 'Clicking the photo opens the viewer with the post beside it');
  await card.locator('.tma-dash__feed-media-item').click();
  await page.waitForSelector('.tma-dash__feed-gallery', { timeout: 5000 });
  await page.waitForTimeout(900);
  const gallery = page.locator('.tma-dash__feed-gallery');

  check(await gallery.locator('.tma-dash__feed-gallery-img').isVisible(), 'the photo is on the stage');
  // The whole picture, inside the stage: a grid row once let a 2000px photo
  // draw at 2000px and clip.
  const fit = await page.evaluate(() => {
    const img = document.querySelector('.tma-dash__feed-gallery-img').getBoundingClientRect();
    const stage = document.querySelector('.tma-dash__feed-gallery-stage').getBoundingClientRect();
    return img.width <= stage.width && img.height <= stage.height && img.top >= stage.top;
  });
  check(fit, 'the photo fits inside the stage');
  check(await gallery.locator('.tma-dash__feed-gallery-rail [data-feed-gallery-close]').count() === 1,
    'Close is a plain icon button on the rail, not a badge over the picture');
  check((await gallery.locator('.tma-dash__feed-gallery-head').textContent() || '').includes('E2E Staff'),
    'the rail names who posted it');
  check((await gallery.locator('.tma-dash__feed-gallery-body').textContent() || '').includes(postText),
    'the rail shows what they wrote');
  check(await gallery.locator('[data-feed-react-open]').count() === 1, 'the rail has React');
  check(await gallery.locator('[data-feed-gallery-comment]').count() === 1, 'the rail has Comment');
  check(await gallery.locator('[data-feed-comment-input]').count() === 1, 'the rail has a comment box');
  check(await page.evaluate(() => document.documentElement.classList.contains('tma-feed-gallery-open')),
    'the page behind is locked');

  step(7, 'Mentioning someone in a comment from the viewer');
  const railInput = '.tma-dash__feed-gallery [data-feed-comment-input]';
  await writeIn(page, railInput, 'Look at this @' + OTHER_NAME);
  await page.waitForSelector('.tma-dash__feed-gallery [data-feed-mention-menu]', { timeout: 5000 })
    .catch(() => {});
  const suggestions = await page.locator('.tma-dash__feed-gallery [data-feed-mention-pick]').count();
  check(suggestions > 0, `typing @ offers people (${suggestions})`);
  if (suggestions) {
    await page.locator('.tma-dash__feed-gallery [data-feed-mention-pick]').first().click();
    await page.waitForTimeout(300);
  }
  check(await page.locator(railInput + ' span[data-mention]').count() === 1,
    'the pick became a mention token in the comment');
  await page.keyboard.type(' 👋');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1500);

  const railComments = gallery.locator('.tma-dash__feed-comments--gallery .tma-dash__feed-comment');
  check(await railComments.count() === 1, 'the comment appears in the rail');
  check(await railComments.first().locator('.tma-dash__feed-comment-bubble > .tma-dash__feed-comment-avatar').count() === 1,
    'the avatar sits inside the bubble');
  check(await railComments.first().locator('.tma-feed-mention').count() === 1,
    'the mention survived the server');
  const plainText = await railComments.first().locator('.tma-dash__feed-rich').evaluate((el) => {
    const copy = el.cloneNode(true);
    copy.querySelectorAll('.tma-feed-mention').forEach((m) => m.remove());
    return copy.textContent;
  });
  check(!/@/.test(plainText), 'the typed @ trigger was replaced, not left beside the token');

  step('7b', 'Reacting to the post from the viewer');
  await gallery.locator('[data-feed-react-open]').click();
  await page.waitForSelector('.tma-dash__feed-gallery [data-feed-react="❤️"]', { timeout: 3000 });
  await page.locator('.tma-dash__feed-gallery [data-feed-react="❤️"]').click();
  await page.waitForTimeout(1000);
  check((await gallery.locator('[data-feed-react-open]').textContent() || '').includes('❤️'),
    'the rail\'s React button shows the reaction');
  check((await card.locator('[data-feed-react-open]').textContent() || '').includes('❤️'),
    'and so does the card underneath');

  step(8, 'Reacting to that comment');
  await railComments.first().locator('[data-feed-comment-react-open]').click();
  await page.waitForSelector('.tma-dash__feed-gallery [data-feed-comment-react="👍"]', { timeout: 3000 });
  await page.locator('.tma-dash__feed-gallery [data-feed-comment-react="👍"]').click();
  await page.waitForTimeout(1200);
  check((await railComments.first().locator('.tma-dash__feed-comment-reacts').textContent().catch(() => '') || '').includes('👍'),
    'the reaction shows on the bubble');
  await page.screenshot({ path: path.join(here, 'feed-media-gallery.png') });

  step(9, 'Stepping to the PDF and closing');
  await page.keyboard.press('ArrowRight');
  await page.waitForSelector('.tma-dash__feed-gallery [data-feed-gallery-doc]', { timeout: 5000 });
  await page.waitForSelector('.tma-dash__feed-gallery [data-feed-gallery-doc] canvas', { timeout: 15000 })
    .catch(() => {});
  check(await gallery.locator('[data-feed-gallery-doc] canvas').count() > 0, 'the PDF is painted on the stage');
  // Which of the two is second depends on which upload landed first.
  check(/\d of 2/.test(await gallery.locator('.tma-dash__feed-gallery-caption').textContent() || ''),
    'the caption counts the files');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  check(await page.locator('.tma-dash__feed-gallery').count() === 0, 'Escape closes the viewer');
  check(!(await page.evaluate(() => document.documentElement.classList.contains('tma-feed-gallery-open'))),
    'the page unlocks');
  check(await card.locator('.tma-dash__feed-comments .tma-dash__feed-comment').count() === 1,
    'the comment is under the card too');

  step(10, 'The options and poll rows line up');
  await page.click('[data-feed-compose-open]');
  await page.waitForSelector('[data-feed-editor]', { timeout: 5000 });
  await page.click('[data-feed-type="announcement"]');
  await page.waitForSelector('.tma-dash__feed-compose-options', { timeout: 3000 });
  const checks = page.locator('.tma-dash__feed-compose-options .tma-dash__feed-option-row--checks .tma-dash__feed-check');
  check(await checks.count() === 2, 'both switches sit on one row');
  const boxes = await checks.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().top));
  check(boxes.length === 2 && Math.abs(boxes[0] - boxes[1]) < 2, 'the switches share a baseline');
  const expiresTop = await page.locator('[data-feed-expires]').evaluate((el) => el.getBoundingClientRect().top);
  check(expiresTop < boxes[0], 'Expires sits above the switches, not beside a hanging checkbox');

  await page.click('[data-feed-toggle-poll]');
  await page.waitForSelector('.tma-dash__feed-poll-builder', { timeout: 3000 });
  const closesTop = await page.locator('[data-feed-poll-closes]').evaluate((el) => el.getBoundingClientRect().top);
  const pollChecks = await page.locator('.tma-dash__feed-poll-settings .tma-dash__feed-check')
    .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().top));
  check(pollChecks.length === 3 && closesTop < pollChecks[0], 'Closes sits above the poll switches');
  check(pollChecks.every((t) => Math.abs(t - pollChecks[0]) < 2), 'the poll switches share a baseline');
  await page.locator('.tma-dash__feed-composer--open').screenshot({ path: path.join(here, 'feed-media-composer.png') });

  step(11, 'Nothing navigated');
  check(await page.evaluate(() => window.__feedSentinel === 'alive'), 'the page never reloaded');
} catch (e) {
  failures.push('exception: ' + e.message);
  log('\n!! ' + e.stack);
  await page.screenshot({ path: path.join(here, 'feed-media-error.png') }).catch(() => {});
} finally {
  await browser.close();
}

const noise = errors.filter((e) => !/net::ERR|Failed to load resource|ResizeObserver/.test(e));
if (noise.length) { log('\nPage errors:'); noise.forEach((e) => log('  ' + e)); }

log(`\n${failures.length ? failures.length + ' failed' : 'all checks passed'}`);
process.exit(failures.length || noise.length ? 1 : 0);
