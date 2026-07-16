import { chromium } from 'playwright';

// Drives the real signature editor in a browser. See README.md for setup.
const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8899';
const log = (...a) => console.log(...a);
const errors = [];

const browser = await chromium.launch();
const page = await browser.newPage();

page.on('console', (m) => {
  if (m.type() === 'error') errors.push('console: ' + m.text());
});
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('requestfailed', (r) => {
  errors.push('requestfailed: ' + r.url() + ' ' + (r.failure()?.errorText || ''));
});

function step(n, msg) { log(`\n[${n}] ${msg}`); }

try {
  // ── log in ────────────────────────────────────────────
  step(1, 'Logging in');
  await page.goto(`${BASE}/auth/login`, { waitUntil: 'networkidle' });
  // The sign-in form is behind an "email" choice on this screen.
  await page.click('text=Sign in with Email');
  await page.waitForSelector('input[name="email"]', { state: 'visible', timeout: 8000 });
  await page.fill('input[name="email"]', 'e2e@example.com');
  await page.fill('input[name="password"]', 'password12345');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}),
    page.click('button[type="submit"]:visible'),
  ]);
  await page.waitForTimeout(500);
  log('    url after login:', page.url());
  if (page.url().includes('/auth/login')) {
    const err = await page.textContent('.tma-auth__error').catch(() => null);
    throw new Error('login failed: ' + (err || 'still on the login page'));
  }

  // ── signatures page ───────────────────────────────────
  step(2, 'Opening /signatures');
  await page.goto(`${BASE}/signatures`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);

  const head = await page.textContent('.tma-portal-head__title').catch(() => null);
  log('    page title:', JSON.stringify(head));

  const empty = await page.textContent('.tma-portal-empty__title').catch(() => null);
  log('    empty state:', JSON.stringify(empty));

  // ── create a request from a real library file ─────────
  step(3, 'Creating a signature request from the File Library');
  await page.click('[data-sig-new-dropdown] [data-head-dropdown-toggle]');
  await page.waitForTimeout(200);
  await page.click('[data-sig-new-dropdown] [data-head-dropdown-item="send"]');
  await page.waitForTimeout(900);

  const rows = await page.$$('[data-sig-pick]');
  log('    picker rows:', rows.length);
  const rowText = await page.textContent('.tma-portal-sig-picker__name').catch(() => null);
  log('    first document:', JSON.stringify(rowText));
  if (!rows.length) throw new Error('picker listed no documents');

  await rows[0].click();
  await page.click('[data-sig-new-create]');
  await page.waitForTimeout(900);

  const wizard = await page.$('.tma-portal-sig-wizard');
  log('    wizard opened:', !!wizard);
  if (!wizard) throw new Error('wizard did not open after create');

  // ── recipients ────────────────────────────────────────
  step(4, 'Filling recipient + adding a second, then reordering');
  await page.fill('[data-sig-r-name="0"]', 'Dana Reed');
  await page.fill('[data-sig-r-email="0"]', 'dana@example.com');
  await page.click('[data-sig-add-recipient]');
  await page.waitForTimeout(200);
  await page.fill('[data-sig-r-name="1"]', 'Sam Poll');
  await page.fill('[data-sig-r-email="1"]', 'sam@example.com');

  let names = await page.$$eval('[data-sig-recipient] .tma-portal-sig-wizard__recipient-label',
    (els) => els.map((e) => e.textContent.trim()));
  log('    recipients:', names.join(', '));

  // Move the second recipient up; the typed values must survive the re-render.
  await page.click('[data-sig-move="up"][data-sig-index="1"]');
  await page.waitForTimeout(200);
  const firstName = await page.inputValue('[data-sig-r-name="0"]');
  log('    after reorder, recipient 1 is:', JSON.stringify(firstName));
  if (firstName !== 'Sam Poll') throw new Error('reorder lost or mis-ordered typed input');

  // Put Dana back on top.
  await page.click('[data-sig-move="up"][data-sig-index="1"]');
  await page.waitForTimeout(200);

  // ── into the editor ───────────────────────────────────
  step(5, 'Advancing to the place-fields step (loads pdf.js + real document)');
  await page.click('[data-sig-wizard-next]');
  await page.waitForTimeout(3500); // pdf.js import + worker + first paint

  const canvas = await page.$('[data-sig-canvas]');
  log('    canvas present:', !!canvas);
  if (!canvas) {
    const banner = await page.textContent('.tma-portal-banner__text').catch(() => null);
    throw new Error('no canvas; banner said: ' + banner);
  }

  const thumbs = await page.$$('[data-sig-thumb]');
  log('    page thumbnails:', thumbs.length, '(the fixture PDF has 2 pages)');
  if (thumbs.length !== 2) throw new Error(`expected 2 real pages, got ${thumbs.length}`);

  // Did pdf.js actually paint pixels, or is the canvas blank?
  const painted = await page.evaluate(() => {
    const c = document.querySelector('[data-sig-canvas]');
    const ctx = c.getContext('2d');
    const d = ctx.getImageData(0, 0, c.width, Math.min(c.height, 400)).data;
    let ink = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] < 200 || d[i + 1] < 200 || d[i + 2] < 200) ink++;
    }
    return { width: c.width, height: c.height, inkPixels: ink };
  });
  log('    canvas bitmap:', painted.width + 'x' + painted.height, '| non-white pixels:', painted.inkPixels);
  if (painted.width < 10 || painted.height < 10) throw new Error('canvas has no size');
  if (painted.inkPixels < 50) throw new Error('canvas looks blank - pdf.js did not paint the document');

  // ── place fields ──────────────────────────────────────
  step(6, 'Placing fields');
  const cards = await page.$$eval('[data-sig-field]', (els) => els.map((e) => e.dataset.sigField));
  log('    palette types:', cards.join(', '));
  if (cards.length !== 7) throw new Error(`expected 7 field types, got ${cards.length}`);

  await page.click('[data-sig-field="signature"]');
  await page.waitForTimeout(300);
  let placed = await page.$$('[data-sig-placed]');
  log('    placed after clicking signature:', placed.length);
  if (placed.length !== 1) throw new Error('field was not placed');

  // Drag the placed field and confirm it moves.
  const before = await page.$eval('[data-sig-placed]', (e) => e.style.left);
  const box = await placed[0].boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 90, box.y + box.height / 2 + 40, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const after = await page.$eval('[data-sig-placed]', (e) => e.style.left);
  log('    field left before/after drag:', before, '->', after);
  if (before === after) throw new Error('dragging did not move the field');

  // Assign panel should be showing for the selected field.
  const assignOpts = await page.$$eval('[data-sig-field-assign] option', (o) => o.map((x) => x.textContent.trim()));
  log('    assign dropdown:', assignOpts.join(' | '));
  if (assignOpts.length !== 2) throw new Error('assign dropdown should list both recipients');

  // The assign control must be reachable, not stranded below the fold.
  const assignReach = await page.evaluate(() => {
    const el = document.querySelector('[data-sig-field-assign]');
    if (!el) return { found: false };
    el.scrollIntoView({ block: 'nearest' });
    const r = el.getBoundingClientRect();
    const panel = document.querySelector('.tma-portal-sig-wizard__fields-panel');
    return {
      found: true,
      inViewport: r.top >= 0 && r.bottom <= window.innerHeight,
      panelScrollable: panel.scrollHeight > panel.clientHeight,
    };
  });
  log('    assign control reachable:', JSON.stringify(assignReach));
  if (!assignReach.inViewport) throw new Error('assign control cannot be scrolled into view');

  await page.screenshot({ path: new URL('./editor-fields.png', import.meta.url).pathname });
  log('    SCREENSHOT: editor-fields.png (place-fields step, page 1)');

  step(7, 'Switching to page 2 and placing a date field');
  await page.click('[data-sig-page="1"]');
  await page.waitForTimeout(1200);
  const onPage2 = await page.$$('[data-sig-placed]');
  log('    fields visible on page 2 before placing:', onPage2.length, '(should be 0)');
  await page.click('[data-sig-field="date"]');
  await page.waitForTimeout(300);
  log('    fields on page 2 after placing:', (await page.$$('[data-sig-placed]')).length);

  const badges = await page.$$eval('.tma-portal-sig-wizard__page-badge', (b) => b.map((x) => x.textContent));
  log('    thumbnail field-count badges:', badges.join(','));

  // ── persist ───────────────────────────────────────────
  step(8, 'Saving (Next step) and verifying persistence via the API');
  await page.click('[data-sig-wizard-next]');
  await page.waitForTimeout(1200);

  const reqId = await page.evaluate(() => {
    return document.querySelector('.tma-portal-sig-wizard') ? window.__sigId || null : null;
  });

  const saved = await page.evaluate(async () => {
    const list = await fetch('/portal/signatures', { headers: { Accept: 'application/json' } }).then((r) => r.json());
    const id = list.requests[0].id;
    const f = await fetch('/portal/signatures/' + id + '/fields', { headers: { Accept: 'application/json' } }).then((r) => r.json());
    return { id, status: list.requests[0].status, recipients: list.requests[0].recipients.map((r) => r.name + '#' + r.order), fields: f.fields };
  });
  log('    request status:', saved.status);
  log('    recipients saved:', saved.recipients.join(', '));
  log('    fields saved:', saved.fields.length);
  saved.fields.forEach((f) => {
    log(`      - ${f.type} page ${f.page} @ x=${f.x.toFixed(3)} y=${f.y.toFixed(3)} req=${f.required}`);
  });
  if (saved.fields.length !== 2) throw new Error('fields did not persist');
  if (!saved.fields.every((f) => f.x >= 0 && f.x <= 1 && f.y >= 0 && f.y <= 1)) {
    throw new Error('persisted coordinates are not page-relative fractions');
  }
  if (!saved.fields.some((f) => f.page === 2)) throw new Error('page-2 field lost its page');

  await page.screenshot({ path: new URL('./editor.png', import.meta.url).pathname, fullPage: false });
  log('\nSCREENSHOT: editor.png');
  log('\n=== RESULT: PASS ===');
} catch (err) {
  log('\n=== RESULT: FAIL ===');
  log(String(err.message));
  await page.screenshot({ path: new URL('./failure.png', import.meta.url).pathname }).catch(() => {});
  process.exitCode = 1;
} finally {
  if (errors.length) {
    log('\n--- browser errors ---');
    [...new Set(errors)].slice(0, 12).forEach((e) => log('  ' + e));
  } else {
    log('\n--- no browser console errors ---');
  }
  await browser.close();
}
