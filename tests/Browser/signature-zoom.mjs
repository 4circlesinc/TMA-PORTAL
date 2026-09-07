import { chromium } from 'playwright';
import { execSync } from 'node:child_process';

// Drives the placement canvas's zoom controls. See README.md for setup.
const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8899';
const log = (...a) => console.log(...a);
const errors = [];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
// The harness origin isn't in the WebSocket allow-list; that's expected here.
const noise = (t) => t.includes('realtime disabled') || t.includes('Origin not allowed');
page.on('console', (m) => { if (m.type() === 'error' && !noise(m.text())) errors.push('console: ' + m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

try {
  await page.goto(`${BASE}/auth/login`, { waitUntil: 'networkidle' });
  await page.click('text=Sign in with Email');
  await page.waitForSelector('input[name="email"]', { state: 'visible', timeout: 8000 });
  await page.fill('input[name="email"]', 'e2e@example.com');
  await page.fill('input[name="password"]', 'password12345');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}),
    page.click('button[type="submit"]:visible'),
  ]);
  await page.waitForTimeout(600);
  // New-device email code: MAIL_MAILER=log puts the message in the app log.
  if (page.url().includes('/auth/login-code')) {
    const code = execSync(
      `grep -oE '>[0-9]{6}<' storage/logs/laravel.log | tail -1 | tr -d '><'`
    ).toString().trim();
    log('    sign-in code from mail log:', JSON.stringify(code));
    if (!/^[0-9]{6}$/.test(code)) throw new Error('could not read the sign-in code');
    // An OTP widget: the named input is hidden, so type into the boxes.
    await page.click('[data-otp] input:not([type=hidden])').catch(() => {});
    await page.keyboard.type(code, { delay: 40 });
    await page.waitForTimeout(300);
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}),
      page.click('button[type="submit"]:visible'),
    ]);
    await page.waitForTimeout(700);
    log('    url after code:', page.url());
  }

  // "Stay signed in?" interstitial.
  if (page.url().includes('/auth/stay-signed-in')) {
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}),
      page.click('button[type="submit"]:visible'),
    ]);
    await page.waitForTimeout(700);
    log('    url after stay-signed-in:', page.url());
  }

  if (page.url().includes('/auth/login')) throw new Error('login failed');

  await page.goto(`${BASE}/signatures`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await page.waitForSelector('.tma-portal-page--signatures', { timeout: 15000 });

  await page.click('[data-sig-new-dropdown] [data-head-dropdown-toggle]');
  await page.waitForTimeout(250);
  await page.click('[data-sig-new-dropdown] [data-head-dropdown-item="send"]');
  await page.waitForTimeout(1000);
  const rows = await page.$$('[data-sig-pick]');
  if (!rows.length) throw new Error('picker listed no documents');
  await rows[0].click();
  await page.click('[data-sig-new-create]');
  await page.waitForTimeout(1000);

  await page.fill('[data-sig-r-name="0"]', 'Dana Reed');
  await page.fill('[data-sig-r-email="0"]', 'dana@example.com');
  await page.click('[data-sig-wizard-next]');
  await page.waitForTimeout(4000);

  const bar = await page.$('[data-sig-zoom-label]');
  log('\n[1] zoom bar present:', !!bar);
  if (!bar) throw new Error('no zoom bar rendered');

  const read = () => page.evaluate(() => {
    const sheet = document.querySelector('[data-sig-page-host]');
    const c = document.querySelector('[data-sig-canvas]');
    const pane = document.querySelector('[data-sig-canvas-scroll]');
    return {
      label: document.querySelector('[data-sig-zoom-label]').textContent,
      sheetW: Math.round(sheet.getBoundingClientRect().width),
      bitmapW: c.width,
      scrollW: pane.scrollWidth, clientW: pane.clientWidth,
      fitActive: document.querySelector('[data-sig-zoom-fit]').classList.contains('is-active'),
    };
  });

  const ink = () => page.evaluate(() => {
    const c = document.querySelector('[data-sig-canvas]');
    const d = c.getContext('2d').getImageData(0, 0, c.width, Math.min(c.height, 400)).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] < 200 || d[i+1] < 200 || d[i+2] < 200) n++;
    return n;
  });

  const base = await read();
  log('[2] fit-width default:', JSON.stringify(base), '| ink:', await ink());
  if (!base.fitActive) throw new Error('Fit should be active by default');

  // Place a field now, so we can prove zoom does not move it.
  await page.click('[data-sig-field="signature"]');
  await page.waitForTimeout(400);
  const coordsBefore = await page.evaluate(() => {
    const el = document.querySelector('[data-sig-placed]');
    return el ? { x: el.style.left, y: el.style.top, w: el.style.width } : null;
  });
  log('[3] placed field style:', JSON.stringify(coordsBefore));

  await page.click('[data-sig-zoom-in]');
  await page.waitForTimeout(900);
  const z1 = await read();
  log('[4] after zoom in:', JSON.stringify(z1), '| ink:', await ink());
  if (z1.sheetW <= base.sheetW) throw new Error('zoom in did not widen the sheet');
  if (z1.bitmapW <= base.bitmapW) throw new Error('canvas did not re-rasterise larger (would be blurry)');
  if (z1.fitActive) throw new Error('Fit should no longer be active');

  await page.click('[data-sig-zoom-in]');
  await page.click('[data-sig-zoom-in]');
  await page.waitForTimeout(1100);
  const z2 = await read();
  log('[5] after two more:', JSON.stringify(z2));
  if (z2.scrollW <= z2.clientW) throw new Error('sheet should overflow and pan at high zoom');

  // Coordinates are fractions: the field must sit at the same % of the page.
  const coordsAfter = await page.evaluate(() => {
    const el = document.querySelector('[data-sig-placed]');
    return el ? { x: el.style.left, y: el.style.top, w: el.style.width } : null;
  });
  log('[6] field style after zoom:', JSON.stringify(coordsAfter));
  if (JSON.stringify(coordsBefore) !== JSON.stringify(coordsAfter)) {
    throw new Error('zoom changed the stored field position');
  }

  await page.click('[data-sig-zoom-fit]');
  await page.waitForTimeout(900);
  const fit = await read();
  log('[7] after Fit:', JSON.stringify(fit));
  if (!fit.fitActive) throw new Error('Fit not re-activated');
  if (Math.abs(fit.sheetW - base.sheetW) > 2) throw new Error('Fit did not restore the original width');

  // ctrl+scroll
  const box = await page.$eval('[data-sig-canvas-scroll]', (e) => {
    const r = e.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await page.mouse.move(box.x, box.y);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -120);
  await page.keyboard.up('Control');
  await page.waitForTimeout(900);
  const wheel = await read();
  log('[8] after ctrl+wheel up:', JSON.stringify(wheel));
  if (wheel.sheetW <= fit.sheetW) throw new Error('ctrl+wheel did not zoom in');

  // bare wheel must scroll, not zoom
  const beforeBare = await read();
  await page.mouse.wheel(0, 120);
  await page.waitForTimeout(500);
  const bare = await read();
  log('[9] after bare wheel:', JSON.stringify(bare));
  if (bare.sheetW !== beforeBare.sheetW) throw new Error('bare wheel must scroll, not zoom');

  // keyboard
  await page.keyboard.press('Control+Equal');
  await page.waitForTimeout(800);
  const kb = await read();
  log('[10] after Ctrl+=:', JSON.stringify(kb));
  if (kb.sheetW <= bare.sheetW) throw new Error('Ctrl+= did not zoom in');

  await page.keyboard.press('Control+0');
  await page.waitForTimeout(800);
  const kb0 = await read();
  log('[11] after Ctrl+0:', JSON.stringify(kb0));
  if (!kb0.fitActive) throw new Error('Ctrl+0 did not restore fit');

  log('\nerrors:', errors.length ? errors : 'none');
  if (errors.length) throw new Error('console/page errors: ' + errors.join(' | '));
  log('\nZOOM OK');
} catch (e) {
  log('\nFAILED:', e.message);
  log('errors:', errors);
  process.exitCode = 1;
} finally {
  await browser.close();
}
