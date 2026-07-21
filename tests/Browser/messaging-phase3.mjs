import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Phase 3: message attachments.
//
// Files are uploaded and *staged* the moment they are chosen, then claimed by
// a message on send. That ordering is what makes a pre-send preview, a progress
// bar, a remove button and a retry possible — and it is why a failed upload can
// never take the typed message with it, which this script pins directly.
//
// See README.md for setup. Needs the messaging seed.
const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8899';
const EMAIL = process.env.TMA_EMAIL || 'e2e@example.com';

const PHOTO = join(HERE, 'fixtures/message-photo.png');
const NOTES = join(HERE, 'fixtures/message-notes.txt');
const BUNDLE = join(HERE, 'fixtures/message-bundle.zip');
const LARGE = join(HERE, 'fixtures/message-large.png');
const DANGER = join(HERE, 'fixtures/message-danger.php');

const log = (...a) => console.log(...a);
const failures = [];
const errors = [];

function step(n, msg) { log(`\n[${n}] ${msg}`); }
function check(ok, msg) {
  log(`    ${ok ? '✓' : '✗'} ${msg}`);
  if (!ok) failures.push(msg);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => {
  // 422 is expected where the script deliberately uploads a blocked type.
  if (m.type() === 'error' && !/403|404|422|favicon/.test(m.text())) {
    errors.push('console: ' + m.text());
  }
});

const trayCount = () => page.locator('[data-messages-tray-item]').count();

try {
  step(1, 'Sign in and open a conversation');
  await page.goto(`${BASE}/auth/login`, { waitUntil: 'networkidle' });
  await page.click('text=Sign in with Email');
  await page.waitForSelector('input[name="email"]', { state: 'visible', timeout: 8000 });
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', 'password12345');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}),
    page.click('button[type="submit"]:visible'),
  ]);
  await page.goto(`${BASE}/social/messages`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.tma-dash__messages-row', { timeout: 15000 });
  await page.locator('.tma-dash__messages-row', { hasText: 'Ana Ruiz' }).first().click();
  await page.waitForTimeout(1500);
  check(await page.locator('.tma-dash__messages-bubble').count() > 0, 'thread loaded');

  step(2, 'The attach button is live, not disabled');
  const attach = page.locator('[data-messages-composer-attach]');
  check(await attach.count() === 1, 'attach button present');
  check(!(await attach.isDisabled()), 'attach button is enabled');

  step(3, 'Choosing files shows previews before sending');
  await page.setInputFiles('[data-messages-composer-file]', [PHOTO, NOTES]);
  await page.waitForTimeout(2500);

  check(await trayCount() === 2, `${await trayCount()} files staged in the composer`);
  const trayText = await page.textContent('.tma-dash__messages-tray');
  check(/message-photo\.png/.test(trayText), 'the image is named');
  check(/message-notes\.txt/.test(trayText), 'the text file is named');
  check(/B\b|KB/.test(trayText), 'file sizes are shown');
  check(
    await page.locator('.tma-dash__messages-tray-thumb img').count() === 2,
    'each file shows a thumbnail or a type icon',
  );

  step(4, 'Nothing has been sent yet — staging is not sending');
  const beforeSend = await page.locator('.tma-dash__messages-bubble').count();
  const bodyBefore = await page.textContent('[data-messages-chat-body]');
  check(!/message-photo\.png/.test(bodyBefore), 'no attachment bubble exists before send');

  step(5, 'A staged file can be removed before sending');
  await page.locator('[data-messages-tray-remove]').first().click();
  await page.waitForTimeout(1200);
  check(await trayCount() === 1, `one file left after removing (${await trayCount()})`);

  step(6, 'Text typed alongside the files survives');
  const caption = 'attachment caption ' + Date.now();
  await page.click('[data-messages-composer-input]');
  await page.keyboard.type(caption);
  await page.waitForTimeout(300);
  check(
    (await page.textContent('[data-messages-composer-input]')).includes(caption),
    'the caption is still in the composer with a file staged',
  );

  step(7, 'Sending delivers both the file and the caption');
  await page.click('[data-messages-composer-send]');
  await page.waitForTimeout(2500);

  const afterSend = await page.textContent('[data-messages-chat-body]');
  check(afterSend.includes(caption), 'the caption arrived');
  check(/message-notes\.txt/.test(afterSend), 'the file arrived as an attachment');
  check(await trayCount() === 0, 'the composer tray emptied');
  check(
    await page.locator('.tma-dash__messages-bubble').count() > beforeSend,
    'a new message bubble exists',
  );

  step(8, 'A blocked file type is refused, and the typed text is kept');
  const keepMe = 'must not be lost ' + Date.now();
  await page.click('[data-messages-composer-input]');
  await page.keyboard.type(keepMe);
  await page.setInputFiles('[data-messages-composer-file]', [DANGER]);
  await page.waitForTimeout(2500);

  const failedItem = await page.locator('.tma-dash__messages-tray-item.is-failed').count();
  check(failedItem === 1, 'the upload is marked as failed');
  const failText = await page.textContent('.tma-dash__messages-tray');
  check(/not allowed|executable|script/i.test(failText), `the reason is shown (${failText.trim().slice(0, 60)})`);
  check(
    (await page.textContent('[data-messages-composer-input]')).includes(keepMe),
    'the composed text survived the failed upload',
  );

  // Clear the failed item so it doesn't bleed into later steps.
  await page.locator('[data-messages-tray-remove]').first().click();
  await page.waitForTimeout(600);

  step(9, 'An image sends and renders as a picture');
  // Clear the composer deterministically — Control+A in a contenteditable can
  // select the document rather than the field, which previously left the
  // caption attached to the "image only" message.
  await page.evaluate(() => {
    const el = document.querySelector('[data-messages-composer-input]');
    el.textContent = '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(400);
  await page.setInputFiles('[data-messages-composer-file]', [PHOTO]);
  await page.waitForTimeout(2500);
  await page.click('[data-messages-composer-send]');
  await page.waitForTimeout(2500);

  const images = await page.locator('.tma-dash__messages-attachment--image img').count();
  check(images > 0, `image rendered inline (${images})`);

  const dims = await page.evaluate(() => {
    const img = document.querySelector('.tma-dash__messages-attachment--image img');
    return img ? { natural: img.naturalWidth, ratio: img.style.aspectRatio || null } : null;
  });
  check(dims?.natural > 0, `the image actually loaded (natural width ${dims?.natural})`);
  check(!!dims?.ratio, `space is reserved from stored dimensions (${dims?.ratio})`);

  step(10, 'Clicking an image opens the shared lightbox');
  await page.locator('.tma-dash__messages-attachment--image').last().click();
  await page.waitForTimeout(1000);
  check(await page.locator('.tma-portal-lightbox').count() === 1, 'lightbox opened');
  check(
    await page.locator('.tma-portal-lightbox__img').count() === 1,
    'it shows the image itself',
  );
  // Close via the lightbox's own control. Escape is also bound to *closing the
  // conversation*, which would take the composer with it.
  await page.locator('.tma-portal-lightbox [data-lb-close]').last().click();
  await page.waitForTimeout(600);
  check(await page.locator('.tma-portal-lightbox').count() === 0, 'closing it works');

  step(11, 'A document opens the lightbox with a download, not a broken viewer');
  await page.setInputFiles('[data-messages-composer-file]', [BUNDLE]);
  await page.waitForTimeout(2500);
  await page.click('[data-messages-composer-send]');
  await page.waitForTimeout(2500);

  const fileTiles = await page.locator('.tma-dash__messages-attachment--file').count();
  check(fileTiles > 0, `document rendered as a file tile (${fileTiles})`);
  await page.locator('.tma-dash__messages-attachment--file').last().click();
  await page.waitForTimeout(900);
  check(
    await page.locator('.tma-portal-lightbox__nopreview').count() === 1,
    'a zip gets an honest "no preview" card',
  );
  check(
    await page.locator('.tma-portal-lightbox [data-lb-download]').count() === 1,
    'and a download link',
  );
  await page.locator('.tma-portal-lightbox [data-lb-close]').last().click();
  await page.waitForTimeout(600);

  step(12, 'Attachments survive a reload');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.tma-dash__messages-row', { timeout: 15000 });
  await page.locator('.tma-dash__messages-row', { hasText: 'Ana Ruiz' }).first().click();
  await page.waitForTimeout(2000);
  check(
    await page.locator('.tma-dash__messages-attachment').count() > 0,
    'attachments are still there after a full reload',
  );

  step(13, 'Replying to a file shows what kind of file it was');
  const fileBubble = page.locator('.tma-dash__messages-bubble-row', {
    has: page.locator('.tma-dash__messages-attachment--image'),
  }).last();
  await fileBubble.click({ button: 'right', force: true });
  await page.waitForTimeout(700);
  await page.locator('[data-menu-action="reply"]').click();
  await page.waitForTimeout(600);

  // The image was sent without a caption, so the preview has only the media to
  // describe. A captioned photo would correctly preview its caption instead.
  const previewText = await page.textContent('.tma-dash__messages-reply-preview');
  check(/photo/i.test(previewText), `the reply preview names the media (${previewText.trim().slice(0, 40)})`);

  await page.click('[data-messages-composer-input]');
  await page.keyboard.type('reply to a photo');
  await page.click('[data-messages-composer-send]');
  await page.waitForTimeout(2000);

  check(
    await page.locator('.tma-dash__messages-bubble-quote-thumb').count() > 0,
    'the sent reply quotes the image with a thumbnail',
  );

  step(13.5, 'A large image is served as a generated thumbnail');
  await page.setInputFiles('[data-messages-composer-file]', [LARGE]);
  await page.waitForTimeout(6000);
  await page.click('[data-messages-composer-send]');
  await page.waitForTimeout(4000);

  const thumbed = await page.evaluate(async (base) => {
    const list = await fetch(base + '/portal/messaging/conversations', {
      headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      credentials: 'same-origin',
    }).then((r) => r.json());
    const conv = list.conversations.find((c) => c.name === 'Ana Ruiz');
    const thread = await fetch(base + '/portal/messaging/conversations/' + conv.id + '/messages', {
      headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      credentials: 'same-origin',
    }).then((r) => r.json());

    const big = thread.messages
      .flatMap((m) => m.attachments || [])
      .find((a) => a.name === 'message-large.png');
    if (!big) return null;

    // Fetch both and compare, so "a thumbnail exists" means it is genuinely
    // smaller rather than merely a second URL.
    const full = await fetch(big.url, { credentials: 'same-origin' }).then((r) => r.arrayBuffer());
    const thumb = big.thumbUrl
      ? await fetch(big.thumbUrl, { credentials: 'same-origin' }).then((r) => r.arrayBuffer())
      : null;

    return { hasThumb: !!big.thumbUrl, fullBytes: full.byteLength, thumbBytes: thumb ? thumb.byteLength : null };
  }, BASE);

  check(thumbed?.hasThumb, 'a thumbnail was generated for the large image');
  check(
    thumbed && thumbed.thumbBytes < thumbed.fullBytes / 4,
    `thumbnail is far smaller (${thumbed?.thumbBytes} vs ${thumbed?.fullBytes} bytes)`,
  );

  const renderedSrc = await page.evaluate(() => {
    const imgs = [...document.querySelectorAll('.tma-dash__messages-attachment--image img')];
    return imgs.length ? imgs[imgs.length - 1].getAttribute('src') : null;
  });
  check(/\/thumb$/.test(renderedSrc || ''), `the bubble renders the thumbnail, not the original (${renderedSrc?.slice(-24)})`);

  step(14, 'Attachments are not reachable without membership');
  const status = await page.evaluate(async (base) => {
    const res = await fetch(base + '/portal/messaging/attachments/00000000-0000-4000-8000-000000000000', {
      headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      credentials: 'same-origin',
    });
    return res.status;
  }, BASE);
  check(status === 404, `an unknown attachment returns ${status}`);

  await page.screenshot({ path: join(HERE, 'messaging-phase3.png') });
  log('\nwrote messaging-phase3.png');
} catch (err) {
  failures.push('threw: ' + err.message);
  log('\nERROR: ' + err.message);
} finally {
  await browser.close();
}

if (errors.length) {
  log('\nPage errors:');
  errors.forEach((e) => log('  ' + e));
}

log('\n' + (failures.length ? `FAILED (${failures.length})` : 'ALL CHECKS PASSED'));
failures.forEach((f) => log('  ✗ ' + f));
process.exit(failures.length ? 1 : 0);
