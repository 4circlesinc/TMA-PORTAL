import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

/*
 * Adjust photo, on the passport photo of Edit application.
 *
 * The control used to take a 2×2 photo or refuse it: a portrait that was not
 * square was turned away with a sentence, and one that was slightly slanted
 * was filed slanted. TMAPhotoAdjuster puts the picture behind a fixed square
 * the reader can drag, zoom, turn in quarter turns and straighten, under a
 * grid of hairlines. None of that exists outside a browser (canvas, pointer
 * drags, range inputs), so this is where it is pinned:
 *
 *  - a photo that is not square opens the adjuster instead of an error;
 *  - straighten, zoom and drag move the readouts, and Use photo hands back a
 *    square of at least 600 px that the form accepts and the server files;
 *  - Adjust photo reopens where the last adjustment stopped, cut from the
 *    picture as it was chosen;
 *  - Escape leaves the photo on the form alone;
 *  - after a reload the FILED photo opens in the adjuster too;
 *  - a ready 2×2 is taken as it is with no dialog, and one too small is
 *    still refused in words;
 *  - the grid is drawn, and lightly: the frame's pixels on a grid line differ
 *    from their neighbours, but by a small step, not a black or white rule.
 *
 * Needs the standard throwaway server with FEATURE_CIP=true, an
 * administrator (TMA_STAFF_EMAIL), and TMA_APP, the uuid of a filed,
 * unlocked application. See README.
 */
const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8899';
const EMAIL = process.env.TMA_STAFF_EMAIL || 'e2e@example.com';
const PASSWORD = process.env.TMA_STAFF_PASSWORD || 'password12345';
const APP = process.env.TMA_APP;
const LOG = process.env.TMA_LOG || 'storage/logs/laravel.log';

if (!APP) throw new Error('TMA_APP (an application uuid) is required');

/* The sign-in code, read out of the mail log (see cip-draft-autosave.mjs). */
function loginCode() {
  const text = readFileSync(LOG, 'utf8');
  const hits = [...text.matchAll(/letter-spacing:\.24em[^>]*>(\d{6})</g)];

  return hits.length ? hits[hits.length - 1][1] : null;
}

const failures = [];
const check = (ok, msg) => { console.log(`    ${ok ? '✓' : '✗'} ${msg}`); if (!ok) failures.push(msg); };
const step = (n, msg) => console.log(`\n[${n}] ${msg}`);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.addInitScript(() => { try { localStorage.setItem('tma.legalAccepted', '1'); } catch (e) { /* asked instead */ } });
const page = await ctx.newPage();
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(e.message));

/*
 * A slanted portrait on a pale studio background, drawn rather than shipped:
 * the test is about dimensions and slant, and a fixture would hide both.
 */
async function portrait(w, h, slant) {
  const b64 = await page.evaluate(({ w, h, slant }) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const x = c.getContext('2d');
    x.fillStyle = '#f7f7f5'; x.fillRect(0, 0, w, h);
    x.save(); x.translate(w / 2, h / 2); x.rotate(slant * Math.PI / 180);
    x.fillStyle = '#1d2433'; x.beginPath(); x.ellipse(0, h * 0.42, w * 0.46, h * 0.30, 0, 0, Math.PI * 2); x.fill();
    x.fillStyle = '#d9a886'; x.beginPath(); x.ellipse(0, -h * 0.10, w * 0.17, h * 0.17, 0, 0, Math.PI * 2); x.fill();
    x.fillStyle = '#2a1c14'; x.beginPath(); x.ellipse(0, -h * 0.21, w * 0.19, h * 0.10, 0, Math.PI, 0); x.fill();
    x.restore();

    return c.toDataURL('image/jpeg', 0.92).split(',')[1];
  }, { w, h, slant });

  return Buffer.from(b64, 'base64');
}

const INPUT = '[data-cip-photo="passportPhoto"]';
const ADJUST = '[data-cip-photo-adjust="passportPhoto"]';
const dialog = page.locator('.tma-portal-modal__card.tma-photo-adjust__card');
const previewSize = () => page.evaluate(() => {
  const img = document.querySelector('.tma-dash__clients-photo--passport .tma-dash__clients-photo-preview');

  return img ? [img.naturalWidth, img.naturalHeight] : null;
});
const slide = (name, value) => dialog.locator(`[data-pa-${name}]`).evaluate((el, v) => {
  el.value = String(v);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}, value);

async function openEdit() {
  await page.goto(`${BASE}/citizenship-applications/applications/${encodeURIComponent(APP)}/edit`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-cip-form]', { timeout: 30000 });
  await page.waitForTimeout(3000);
}

try {
  await page.goto(`${BASE}/auth/login`, { waitUntil: 'domcontentloaded' });
  await page.click('text=Sign in with Email');
  await page.waitForSelector('input[name="email"]', { state: 'visible' });
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}), page.click('button[type="submit"]:visible')]);
  await page.waitForTimeout(700);
  if (page.url().includes('/auth/login-code')) {
    await page.waitForTimeout(900);
    const code = loginCode();
    if (!code) throw new Error(`no sign-in code in ${LOG}`);
    await page.locator('.tma-auth__otp-digit').first().click();
    await page.keyboard.type(code, { delay: 40 });
    const trust = page.locator('input[type="checkbox"]').first();
    if (await trust.count()) await trust.check().catch(() => {});
    await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}), page.click('button[type="submit"]:visible')]);
    await page.waitForTimeout(900);
  }
  if (page.url().includes('/auth/stay-signed-in')) {
    await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}), page.click('form:has(input[name="stay"][value="yes"]) button[type="submit"]')]);
    await page.waitForTimeout(700);
  }

  await openEdit();

  step(1, 'A portrait that is not square opens the adjuster instead of being refused');
  await page.setInputFiles(INPUT, { name: 'portrait.jpg', mimeType: 'image/jpeg', buffer: await portrait(900, 1200, 7) });
  await dialog.waitFor({ timeout: 8000 });
  await page.waitForTimeout(300);
  check((await dialog.locator('.tma-portal-modal__title').innerText()).trim() === 'Adjust photo', 'the dialog is Adjust photo');
  check(await page.locator('.tma-dash__clients-photo--passport .tma-portal-field__error').count() === 0, 'no "has to be square" error under the control');
  const stage = await dialog.locator('[data-pa-stage]').boundingBox();
  check(Math.abs(stage.width - stage.height) < 1, `the frame is square (${Math.round(stage.width)}×${Math.round(stage.height)})`);

  step(2, 'The grid is there, and it is light');
  /*
   * Read the frame's own pixels. Along a row that crosses the pale
   * background, the columns on a grid line differ from the columns beside
   * them; that is the grid being drawn. By how much is the other half: a
   * hairline with a soft edge moves the background a little, where a rule
   * drawn in solid black or white would move it by most of the scale.
   */
  const grid = await dialog.locator('[data-pa-canvas]').evaluate((canvas) => {
    const c = canvas.getContext('2d');
    const side = canvas.width;
    const y = Math.round(side * 0.04);
    const row = c.getImageData(0, y, side, 1).data;
    const lum = i => (row[i * 4] + row[i * 4 + 1] + row[i * 4 + 2]) / 3;
    const base = lum(Math.round(side * 0.5));
    let deepest = 0;
    for (const at of [1 / 3, 2 / 3]) {
      const x = Math.round(side * at);
      for (let i = x - 3; i <= x + 3; i++) deepest = Math.max(deepest, Math.abs(lum(i) - base));
    }

    return { base: Math.round(base), deepest: Math.round(deepest) };
  });
  check(grid.deepest >= 3, `a third line is drawn over the background (moves it by ${grid.deepest} of 255)`);
  check(grid.deepest <= 70, `and lightly, not as a solid rule (${grid.deepest} of 255 on a background of ${grid.base})`);

  step(3, 'Straighten, zoom and drag');
  await slide('tilt', -7);
  check((await dialog.locator('[data-pa-tilt-value]').innerText()).trim() === '-7°', 'the straighten readout says -7°');
  await slide('zoom', 1.5);
  check((await dialog.locator('[data-pa-zoom-value]').innerText()).trim() === '150%', 'the zoom readout says 150%');
  const before = await dialog.locator('[data-pa-canvas]').evaluate(c => c.toDataURL().length);
  await page.mouse.move(stage.x + stage.width / 2, stage.y + stage.height / 2);
  await page.mouse.down();
  await page.mouse.move(stage.x + stage.width / 2 + 12, stage.y + stage.height / 2 + 60, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  const after = await dialog.locator('[data-pa-canvas]').evaluate(c => c.toDataURL().length);
  check(before !== after, 'dragging moves the picture in the frame');

  step(4, 'Use photo hands back a square the form accepts');
  await dialog.locator('[data-pa-apply]').click();
  await page.waitForTimeout(800);
  const cut = await previewSize();
  check((await dialog.count()) === 0, 'the dialog closes');
  check(!!cut && cut[0] === cut[1], `the photo on the form is square (${cut})`);
  check(!!cut && cut[0] >= 600, 'and at least 600 px');
  check(await page.locator('.tma-dash__clients-photo--passport .tma-portal-field__error').count() === 0, 'with no error');

  step(5, 'Adjust photo reopens where the last adjustment stopped');
  await page.click(ADJUST);
  await dialog.waitFor({ timeout: 8000 });
  await page.waitForTimeout(300);
  check((await dialog.locator('[data-pa-tilt-value]').innerText()).trim() === '-7°', 'still straightened by -7°');
  check((await dialog.locator('[data-pa-zoom-value]').innerText()).trim() === '150%', 'still at 150%');
  await dialog.locator('[data-pa-turn="1"]').click();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  check((await dialog.count()) === 0, 'Escape closes it');
  check(JSON.stringify(await previewSize()) === JSON.stringify(cut), 'and the photo on the form is the one from before');

  step(6, 'The adjusted photo is filed with the application');
  await page.mouse.move(1000, 700);
  const saved = page.waitForResponse(r => r.url().includes('/portal/cip/applications/' + APP) && r.request().method() === 'POST');
  await page.click('[data-cip-save]');
  check((await saved).status() === 200, 'Save answers 200');
  // A saved edit goes back to the application it edited, not to the table.
  await page.waitForSelector('[data-clients-edit-application]', { timeout: 15000 }).catch(() => {});
  check(await page.locator('[data-cip-form]').count() === 0
    && await page.locator('[data-clients-edit-application]').count() > 0
    && await page.locator('table.tma-cip-table').count() === 0,
  'and lands on the application\'s details page');

  step(7, 'After a reload, the filed photo opens in the adjuster');
  await openEdit();
  const filed = await previewSize();
  check(!!filed && filed[0] === filed[1] && filed[0] >= 600, `the filed photo is the square (${filed})`);
  await page.click(ADJUST);
  await dialog.waitFor({ timeout: 8000 });
  await page.waitForTimeout(300);
  check((await dialog.locator('[data-pa-zoom-value]').innerText()).trim() === '100%', 'opened from the filed copy, at 100%');
  await dialog.locator('[data-pa-cancel]').click();
  await page.waitForTimeout(300);
  check((await dialog.count()) === 0, 'Cancel closes it');

  step(8, 'A ready 2×2 is taken as it is');
  await page.setInputFiles(INPUT, { name: 'square.jpg', mimeType: 'image/jpeg', buffer: await portrait(600, 600, 0) });
  await page.waitForTimeout(900);
  check((await dialog.count()) === 0, 'no dialog');
  check(JSON.stringify(await previewSize()) === '[600,600]', 'the photo is on the form');
  check(await page.locator(ADJUST).count() === 1, 'with Adjust photo under it');

  step(9, 'One too small is still refused in words');
  await page.setInputFiles(INPUT, { name: 'small.jpg', mimeType: 'image/jpeg', buffer: await portrait(400, 500, 0) });
  await page.waitForTimeout(900);
  check((await dialog.count()) === 0, 'no dialog');
  const why = await page.locator('.tma-dash__clients-photo--passport .tma-portal-field__error').first().innerText().catch(() => '');
  check(/at least 600/.test(why), `the control says why (${why.trim()})`);

  check(pageErrors.length === 0, `no script errors (${pageErrors.join(' | ') || 'none'})`);
} finally {
  await browser.close();
}

if (failures.length) {
  console.log(`\n${failures.length} failure(s)`);
  process.exit(1);
}
console.log('\nall good');
