import { chromium } from 'playwright';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Forwarding a message.
//
// It used to ask for the destination with window.prompt, which the desktop
// app does not have, and whatever was forwarded arrived as one line of text:
// a photo became "Forwarded: photo.png". What only a browser can check now:
// Forward opens the portal's own dialog and never a native one; the caption
// is there to be written, changed or left; the list narrows as you search;
// the photo arrives in the other person's open thread as a photo that
// actually loads, marked Forwarded, with the caption as it was left; and one
// forward can go to several conversations.
//
// Two live sessions and Reverb, same setup and seed as messaging-realtime.mjs.
const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8899';
const USER_A = process.env.TMA_EMAIL || 'e2e@example.com';      // Test User
const USER_B = process.env.TMA_EMAIL_B || 'user0@example.com';  // Ana Ruiz
const PHOTO = join(HERE, 'fixtures', 'message-photo.png');
/* Where MAIL_MAILER=log leaves the new-device code. */
const LOG = process.env.TMA_LOG || 'storage/logs/laravel.log';

function loginCode() {
  const hits = [...readFileSync(LOG, 'utf8').matchAll(/letter-spacing:\.24em[^>]*>(\d{6})</g)];
  return hits.length ? hits[hits.length - 1][1] : null;
}

const log = (...a) => console.log(...a);
const failures = [];
function step(n, msg) { log(`\n[${n}] ${msg}`); }
function check(ok, msg) {
  log(`    ${ok ? '✓' : '✗'} ${msg}`);
  if (!ok) failures.push(msg);
}

const browser = await chromium.launch();
const nativeDialogs = [];

async function session(email) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  // The sign-in page asks each new browser to agree to the legal terms first.
  await context.addInitScript(() => { try { localStorage.setItem('tma.legalAccepted', '1'); } catch (e) {} });
  const page = await context.newPage();
  // A prompt, alert or confirm here is the regression.
  page.on('dialog', (d) => { nativeDialogs.push(d.type() + ': ' + d.message()); d.dismiss().catch(() => {}); });

  await page.goto(`${BASE}/auth/login`, { waitUntil: 'networkidle' });
  await page.click('text=Sign in with Email');
  await page.waitForSelector('input[name="email"]', { state: 'visible', timeout: 8000 });
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', 'password12345');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}),
    page.click('button[type="submit"]:visible'),
  ]);
  // A fresh browser is a new device: the six digits come from the mail log.
  if (page.url().includes('/auth/login-code')) {
    await page.waitForTimeout(900);
    const code = loginCode();
    if (!code) throw new Error(`no sign-in code in ${LOG}`);
    await page.locator('.tma-auth__otp-digit').first().click();
    await page.keyboard.type(code, { delay: 40 });
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}),
      page.click('button[type="submit"]:visible'),
    ]);
  }
  const stay = page.locator('form:has(input[name="stay"][value="yes"]) button[type="submit"]');
  if (await stay.count()) {
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}),
      stay.first().click(),
    ]);
  }
  if (page.url().includes('/auth/login')) throw new Error('login failed for ' + email);

  await page.goto(`${BASE}/social/messages`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.tma-dash__messages-row', { timeout: 15000 });
  // A fresh account's sidebar is a hover overlay; a pointer left on it keeps
  // it open over the page.
  await page.mouse.move(900, 600);
  await page.waitForTimeout(1500);
  return page;
}

// By the row's own name, not anything it says: a preview can name anybody.
const row = (page, name) => page
  .locator(`.tma-dash__messages-row:has(.tma-dash__messages-row-name-text:text-is("${name}"))`)
  .first();
const thread = (page) => page.textContent('[data-messages-chat-body]');
const bubble = (page, text) => page.locator('.tma-dash__messages-bubble-row', { hasText: text }).last();

async function eventually(page, ms, probe) {
  for (let waited = 0; waited < ms; waited += 200) {
    if (await probe()) return true;
    await page.waitForTimeout(200);
  }
  return false;
}

/* Open Forward on a bubble through its menu, the way a person does. */
async function openForward(page, target) {
  await target.hover();
  await page.waitForTimeout(200);
  await target.locator('[data-messages-menu]').first().click({ force: true });
  await page.click('[data-menu-action="forward"]');
  await page.waitForSelector('.tma-portal-modal [data-messages-forward-list]', { timeout: 5000 });
}

const tick = (page, name) => page
  .locator('.tma-portal-modal .tma-portal-check-row', { hasText: name })
  .locator('input[type="checkbox"]')
  .check();

const closed = (page) => eventually(page, 8000, async () => (await page.locator('.tma-portal-modal').count()) === 0);

let a, b;
try {
  step(1, 'A sends Peer 01 a photo with nothing written under it');
  a = await session(USER_A);
  b = await session(USER_B);
  await row(b, 'Test User').click();

  await row(a, 'Peer 01').click();
  await a.waitForTimeout(1000);
  await a.setInputFiles('[data-messages-composer-file]', [PHOTO]);
  // A photo passes through the image editor first; it goes as it is, with
  // nothing written under it, and is then staged in the composer.
  await a.waitForSelector('[data-ie-done]', { timeout: 8000 });
  await a.click('[data-ie-done]');
  const photoRow = a.locator('.tma-dash__messages-bubble-row--out:has(.tma-dash__messages-attachments)').last();
  await a.waitForTimeout(2500);
  if ((await photoRow.count()) === 0) await a.click('[data-messages-composer-send]');
  check(await eventually(a, 8000, async () => (await photoRow.count()) === 1), 'the photo is in the thread');

  step(2, 'Forward opens the portal\'s own dialog, with a caption to write');
  await openForward(a, photoRow);
  check(nativeDialogs.length === 0, `no native prompt was raised (${nativeDialogs.join(' | ') || 'none'})`);
  check((await a.textContent('.tma-portal-modal__title')) === 'Forward', 'the dialog is titled Forward');
  // The image editor re-encodes a photo, so the name is the sent file's own.
  const going = await a.textContent('.tma-portal-modal .tma-dash__messages-reply-preview-text');
  check(/^message-photo[\w-]*\.(png|jpe?g|webp)$/i.test(going.trim()), `it says which file is going (${going.trim()})`);
  check((await a.inputValue('[data-messages-forward-body]')) === '', 'the caption starts empty, as the photo had none');
  check(await a.isDisabled('[data-messages-forward-save]'), 'Forward waits for somewhere to send it');
  check((await a.locator('.tma-portal-modal .tma-portal-check-row', { hasText: 'Peer 01' }).count()) === 0,
    'the conversation it is in is not offered');

  step(3, 'The list narrows as you search, and a caption is added on the way');
  await a.fill('[data-messages-forward-search]', 'ana');
  const showing = await a.locator('.tma-portal-modal .tma-portal-check-row:visible').allTextContents();
  check(showing.length === 1 && showing[0].includes('Ana Ruiz'), `searching "ana" leaves Ana Ruiz (${showing.join(', ')})`);

  const caption = 'Site visit, north wall ' + Date.now();
  await a.fill('[data-messages-forward-body]', caption);
  await tick(a, 'Ana Ruiz');
  check(!(await a.isDisabled('[data-messages-forward-save]')), 'ticking her enables Forward');
  await a.click('[data-messages-forward-save]');
  check(await closed(a), 'the dialog closes');
  check(await eventually(a, 3000, async () => (await a.textContent('[data-messages-toast-text]')) === 'Forwarded to Ana Ruiz'),
    'a line says where it went');

  step(4, 'Ana gets the photo itself, marked Forwarded, with the caption, live');
  const hers = bubble(b, caption);
  check(await eventually(b, 8000, async () => (await hers.count()) === 1), 'it arrives in her open thread');
  check((await hers.locator('.tma-dash__messages-bubble-forwarded').textContent()).trim() === 'Forwarded', 'it is marked Forwarded');
  // The file, not a sentence about it: an image that has really loaded.
  const loaded = await eventually(b, 8000, async () => hers.locator('.tma-dash__messages-attachments img').first()
    .evaluate((img) => img.complete && img.naturalWidth > 0).catch(() => false));
  check(loaded, 'the photo loads from its own copy');
  check(!(await thread(b)).includes('Forwarded: '), 'no "Forwarded:" sentence stands in for it');

  const icon = await hers.locator('.tma-dash__messages-bubble-forwarded-icon').evaluate((el) => {
    const style = getComputedStyle(el);
    return { w: style.width, mask: (style.maskImage || style.webkitMaskImage || '').slice(0, 20) };
  });
  check(icon.w === '14px' && icon.mask.startsWith('url("data:image/svg'), `the arrow is drawn (${icon.w})`);

  step(5, 'It is in A\'s own copy of that conversation too, with no reload');
  await row(a, 'Ana Ruiz').click();
  const mine = bubble(a, caption);
  check(await eventually(a, 6000, async () => (await mine.count()) === 1
    && (await mine.locator('.tma-dash__messages-bubble-forwarded').count()) === 1), 'A sees what was forwarded, marked');

  step(6, 'Forwarding it again offers the caption it has, to change');
  await openForward(a, mine);
  check((await a.inputValue('[data-messages-forward-body]')) === caption, 'the caption field holds the caption');
  const changed = 'Same wall, for Peer 04 ' + Date.now();
  await a.fill('[data-messages-forward-body]', changed);
  await tick(a, 'Peer 04');
  await a.screenshot({ path: new URL('./messaging-forward.png', import.meta.url).pathname });
  await a.click('[data-messages-forward-save]');
  check(await closed(a), 'the dialog closes');
  check(await eventually(a, 4000, async () => (await row(a, 'Peer 04').textContent()).includes('Same wall, for Peer 04')),
    "Peer 04's row shows the changed caption");
  check((await thread(a)).includes(caption), 'and the one it was forwarded from keeps its own');

  step(7, 'Words alone go to several conversations at once, as rewritten');
  const asked = bubble(a, 'Which one should I try?');
  await openForward(a, asked);
  check((await a.inputValue('[data-messages-forward-body]')) === 'Which one should I try?', 'the message field holds her words');
  check((await a.textContent('.tma-portal-modal')).includes('Message') && !(await a.textContent('.tma-portal-modal')).includes('Caption'),
    'it is called Message when there is no file');

  await tick(a, 'Peer 02');
  await a.fill('[data-messages-forward-body]', '');
  await a.click('[data-messages-forward-save]');
  check(await eventually(a, 3000, async () => (await a.isVisible('[data-messages-forward-error]'))
    && (await a.textContent('[data-messages-forward-error]')).includes('A message needs some text')),
  'emptied, it is refused in the dialog');

  const rewritten = 'Ana asks which one to try ' + Date.now();
  await a.fill('[data-messages-forward-body]', rewritten);
  await tick(a, 'Peer 03');
  await a.click('[data-messages-forward-save]');
  check(await closed(a), 'the dialog closes');
  check(await eventually(a, 3000, async () => (await a.textContent('[data-messages-toast-text]')) === 'Forwarded to 2 conversations'),
    'a line says it went to two');
  for (const peer of ['Peer 02', 'Peer 03']) {
    check((await row(a, peer).textContent()).includes('Ana asks which one to try'), `${peer}'s row shows it`);
  }

  await row(a, 'Peer 02').click();
  const there = bubble(a, rewritten);
  check(await eventually(a, 6000, async () => (await there.count()) === 1
    && (await there.locator('.tma-dash__messages-bubble-forwarded').count()) === 1), 'opened, it is there and marked');

  check(nativeDialogs.length === 0, `nothing native was raised at any point (${nativeDialogs.join(' | ') || 'none'})`);

  log('\nwrote messaging-forward.png');
} catch (err) {
  failures.push('threw: ' + err.message);
  log('\nERROR: ' + err.message);
} finally {
  await browser.close();
}

log('\n' + (failures.length ? `FAILED (${failures.length})` : 'ALL CHECKS PASSED'));
failures.forEach((f) => log('  ✗ ' + f));
process.exit(failures.length ? 1 : 0);
