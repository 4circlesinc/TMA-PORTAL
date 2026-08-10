import { chromium } from 'playwright';

/**
 * Request Files, from the dialog to the stranger's upload.
 *
 * `FileRequestTest` covers the rules server-side. What only a browser can show
 * is the half that was missing entirely: the Dashboard shortcut and the File
 * Library button used to open two different one-field dialogs that logged a
 * line locally, said "File request sent", and sent nothing — no request, no
 * link, no destination. So this drives the real dialog, then opens the link it
 * produced in a *separate browser context* with no portal session and uploads
 * a file, which is the only way to prove the recipient needs no account.
 *
 *   TMA_BASE_URL=http://127.0.0.1:8899 node tests/Browser/file-requests.mjs
 */
const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8899';
const EMAIL = process.env.TMA_STAFF_EMAIL || 'e2e@example.com';
const failures = [];
const errors = [];
const log = (...a) => console.log(...a);

function step(n, msg) { log(`\n[${n}] ${msg}`); }
function check(ok, msg) {
  log(`    ${ok ? '✓' : '✗'} ${msg}`);
  if (!ok) failures.push(msg);
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1500, height: 950 } });
const page = await context.newPage();

page.on('pageerror', (e) => errors.push(String(e)));
const IGNORE = /realtime disabled|Origin not allowed|4009|Reverb|WebSocket/i;
page.on('console', (m) => {
  if (m.type() === 'error' && !IGNORE.test(m.text())) errors.push(m.text());
});

async function signIn() {
  await page.goto(`${BASE}/auth/login`, { waitUntil: 'domcontentloaded' });
  await page.click('text=Sign in with Email');
  await page.waitForSelector('input[name="email"]', { state: 'visible', timeout: 8000 });
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', 'password12345');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}),
    page.click('button[type="submit"]:visible'),
  ]);
  await page.waitForTimeout(800);
  if (page.url().includes('/auth/stay-signed-in')) {
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}),
      page.click('button[type="submit"]:visible'),
    ]);
    await page.waitForTimeout(500);
  }
  if (page.url().includes('/auth/login')) throw new Error('login failed');
}

let link = null;

try {
  step(1, 'Open the Dashboard and use the Request Files shortcut');
  await signIn();
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-home-shortcut="request-files"]', { timeout: 25000 });
  // Park off the hover-overlay sidebar before clicking anything on the board.
  await page.mouse.move(1200, 700);
  await page.click('[data-home-shortcut="request-files"]');
  await page.waitForSelector('[data-request-body]', { timeout: 8000 });
  check(true, 'the shared dialog opened');

  step(2, 'It asks for everything a real collection needs');
  const fields = await page.evaluate(() => {
    const has = (sel) => !!document.querySelector(sel);
    return {
      title: has('[data-req-title]'),
      message: has('[data-req-message]'),
      destination: has('[data-req-dest-name]'),
      pick: has('[data-req-pick]'),
      recipient: has('[data-req-remail]'),
      types: document.querySelectorAll('[data-req-group]').length,
      size: has('[data-req-size]'),
      multiple: has('[data-req-multiple]'),
      maxFiles: has('[data-req-maxfiles]'),
      expiry: has('[data-req-expiry]'),
      password: has('[data-req-password]'),
      create: has('[data-req-create]'),
      send: has('[data-req-send]'),
      destName: document.querySelector('[data-req-dest-name]')?.textContent?.trim(),
    };
  });
  check(fields.title && fields.message, 'a title and instructions');
  check(fields.destination && fields.pick, `a destination (${fields.destName}) that can be changed`);
  check(fields.recipient, 'who to send it to');
  check(fields.types >= 4, `allowed file types (${fields.types} groups)`);
  check(fields.size, 'a maximum file size');
  check(fields.multiple && fields.maxFiles, 'multiple files, and how many');
  check(fields.expiry, 'an expiry date');
  check(fields.password, 'optional password protection');
  check(fields.create && fields.send, 'and both "create link" and "create and email"');

  step(3, 'The password field stays disabled until it is asked for');
  check(await page.locator('[data-req-password]').isDisabled(), 'disabled by default');
  // The documented switch draws its track over the real <input>, so a plain
  // click lands on the decoration. Every toggle in the portal behaves this way.
  await page.locator('[data-req-use-password]').check({ force: true });
  await page.waitForTimeout(150);
  check(!(await page.locator('[data-req-password]').isDisabled()), 'enabled once the switch is on');
  await page.locator('[data-req-use-password]').uncheck({ force: true });
  await page.waitForTimeout(150);

  step(4, 'Pick a real destination folder without losing what was typed');
  await page.fill('[data-req-title]', 'Passport and proof of address');
  await page.fill('[data-req-message]', 'Colour scans please, all pages.');
  await page.click('[data-req-pick]');
  await page.waitForSelector('[data-req-picker] .tma-portal-picker__list', { timeout: 8000 });

  const folderBtn = page.locator('[data-req-open]').first();
  const folderName = (await folderBtn.textContent().catch(() => ''))?.trim() || '';
  if (await folderBtn.count()) {
    await folderBtn.click();
    await page.waitForTimeout(600);
  }
  await page.click('[data-req-pick-ok]');
  await page.waitForTimeout(300);

  const afterPick = await page.evaluate(() => ({
    dest: document.querySelector('[data-req-dest-name]')?.textContent?.trim(),
    title: document.querySelector('[data-req-title]')?.value,
    message: document.querySelector('[data-req-message]')?.value,
  }));
  log(`      destination now "${afterPick.dest}" (picked "${folderName}")`);
  check(afterPick.title === 'Passport and proof of address',
    'the title survived the folder picker');
  check(afterPick.message === 'Colour scans please, all pages.',
    'and so did the instructions');
  if (folderName) check(afterPick.dest === folderName, `the destination is the folder that was picked`);

  step(5, 'Set the rules and create the link');
  await page.locator('[data-req-group="documents"]').check({ force: true });
  await page.selectOption('[data-req-size]', { index: 0 });
  await page.fill('[data-req-rname]', 'Jane Doe');
  await page.fill('[data-req-remail]', 'jane@example.com');
  await page.click('[data-req-create]');
  await page.waitForSelector('[data-req-link]', { timeout: 10000 });

  link = await page.inputValue('[data-req-link]');
  log(`      link: ${link}`);
  check(/\/r\/[A-Za-z0-9]{20,}/.test(link || ''), 'a long, unguessable /r/ link came back');

  const summary = (await page.textContent('.tma-portal-request__done')) || '';
  check(/PDF/.test(summary), 'the summary states the accepted types');
  check(/Uploads land in/.test(summary), 'and where the uploads will land');
  check(await page.locator('[data-req-done-send]').count() > 0,
    'the link can be emailed straight from the dialog');

  await page.click('.tma-portal-modal__head [data-portal-modal-close]');
  await page.waitForTimeout(300);

  step(6, 'The File Library offers the same dialog for the folder in view');
  await page.goto(`${BASE}/folders/all`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-files-action="request-files"]', { timeout: 20000 });
  await page.mouse.move(1200, 700);
  await page.click('[data-files-action="request-files"]');
  await page.waitForSelector('[data-request-body]', { timeout: 8000 });
  check(true, 'the toolbar button opens the same dialog');
  await page.click('.tma-portal-modal__head [data-portal-modal-close]');

  step(7, 'A client\'s Documents tab offers it too, aimed at that client');
  await page.goto(`${BASE}/clients`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.tma-dash__clients-row, [data-clients-row]', { timeout: 20000 });
  await page.mouse.move(1200, 700);
  await page.locator('.tma-dash__clients-row, [data-clients-row]').first().click();
  await page.waitForTimeout(1500);

  const docsTab = page.locator('[data-clients-tab="folders"], button:has-text("Documents")').first();
  if (await docsTab.count()) {
    await docsTab.click();
    await page.waitForTimeout(1200);
  }

  const clientRequestBtn = page.locator('[data-clients-folder-request]');
  check(await clientRequestBtn.count() > 0, 'the Documents tab has a Request files button');
  if (await clientRequestBtn.count()) {
    await clientRequestBtn.first().click();
    await page.waitForSelector('[data-request-body]', { timeout: 8000 });
    const seeded = await page.evaluate(() => ({
      title: document.querySelector('[data-req-title]')?.value,
      dest: document.querySelector('[data-req-dest-name]')?.textContent?.trim(),
      note: document.querySelector('.tma-portal-request__note')?.textContent || '',
    }));
    log(`      title="${seeded.title}" destination="${seeded.dest}"`);
    // The whole reason this entry point exists: it should arrive knowing which
    // client it is for and which folder is on screen.
    check(/Documents for /.test(seeded.title || ''), 'the dialog opens named after the client');
    check(!!seeded.dest && seeded.dest !== 'File Box', `and aimed at the client's folder (${seeded.dest})`);
    check(/Filed under/.test(seeded.note), 'and says the request is filed under that client');
    await page.click('.tma-portal-modal__head [data-portal-modal-close]');
  }

  step(8, 'A stranger with no portal session can open the link and upload');
  const guest = await browser.newContext({ viewport: { width: 900, height: 900 } });
  const guestPage = await guest.newPage();
  await guestPage.goto(link, { waitUntil: 'domcontentloaded' });

  const heading = (await guestPage.textContent('.card__title').catch(() => '')) || '';
  check(/Passport and proof of address/.test(heading), 'the request title is on the page');
  const body = (await guestPage.textContent('.card__body')) || '';
  check(/Colour scans please/.test(body), 'along with the instructions');
  check(/10 MB/.test(body), 'and the size limit that was set');

  // Nothing about the workspace may leak onto a page anybody with the link
  // can open.
  check(!/Firm Policies doc|Client Intake doc|Templates doc/.test(body),
    'the destination folder\'s contents are not shown');
  check(!(await guestPage.locator('.tma-dash__sidebar').count()),
    'and there is no portal navigation on it');

  await guestPage.setInputFiles('[data-picker]', {
    name: 'passport.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4\n% test document\n'),
  });
  await guestPage.waitForTimeout(2500);

  const state = (await guestPage.textContent('[data-queue]')) || '';
  log(`      queue: ${state.replace(/\s+/g, ' ').trim()}`);
  check(/Uploaded/.test(state), 'the file reports as uploaded');

  const banner = (await guestPage.textContent('[data-banner]')) || '';
  check(/was sent to|were sent to/.test(banner), 'and the page confirms it went to the firm');

  step(9, 'A file type the request refuses is refused');
  await guestPage.setInputFiles('[data-picker]', {
    name: 'holiday.png',
    mimeType: 'image/png',
    buffer: Buffer.from('\x89PNG\r\n\x1a\n' + 'x'.repeat(64)),
  });
  await guestPage.waitForTimeout(1500);
  const refused = (await guestPage.textContent('[data-queue]')) || '';
  check(/only/i.test(refused), `the image is turned away (${refused.replace(/\s+/g, ' ').trim().slice(-60)})`);

  await guest.close();

  step(10, 'The file is in the library, attributed to the request');
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  const arrived = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('[data-tile-id="recentFiles"] [data-home-file]'));
    return rows.map((r) => (r.textContent || '').trim());
  });
  check(arrived.some((t) => /passport\.pdf/i.test(t)),
    `the uploaded file shows up in Recent Files (${arrived.length} rows)`);
} catch (e) {
  failures.push(`threw: ${e.message}`);
  log(`\n✗ ${e.stack}`);
  await page.screenshot({ path: 'tests/Browser/file-requests-error.png' }).catch(() => {});
}

await page.screenshot({ path: 'tests/Browser/file-requests.png' }).catch(() => {});
await browser.close();

if (errors.length) {
  log('\nPage errors:');
  errors.slice(0, 10).forEach((e) => log(`  ! ${e}`));
}

log(`\n${failures.length ? `FAILED (${failures.length})` : 'PASSED'}`);
failures.forEach((f) => log(`  - ${f}`));
process.exit(failures.length ? 1 : 0);
