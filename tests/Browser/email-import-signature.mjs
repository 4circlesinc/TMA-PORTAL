import { chromium } from 'playwright';

// The "Import from Gmail / Outlook" button in Email settings → Sending.
// PHPUnit pins the importer and the endpoint; what only a browser can check
// is the round trip the user actually sees: the click fills the editor with
// the signature lifted from Sent mail, the library gains an active
// "Default From Gmail" entry, the button recovers its label after the morph,
// re-importing reuses the slot instead of stacking duplicates, compose opens
// carrying the imported block, and a 422 degrades to a toast — not a button
// stuck on "Importing…".
//
// See README.md for setup. Needs the mailbox fixture plus Sent messages
// carrying a repeated gmail_signature block (seed-sig fixture).
const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8899';
const EMAIL = process.env.TMA_STAFF_EMAIL || 'e2e@example.com';
const log = (...a) => console.log(...a);
const failures = [];
const pageErrors = [];
const consoleErrors = [];

// The harness environment produces three failures on purpose: the OAuth token
// is fake (mailbox routes answer 409), step 9 stubs the import to 422, and
// the websocket cluster does not list the throwaway server's origin. Anything
// else in the console is a real problem.
const EXPECTED_NOISE = [
  /Origin not allowed/,
  /Failed to load resource:.*(409|422)/,
];

function step(n, msg) { log(`\n[${n}] ${msg}`); }
function check(ok, msg) {
  log(`    ${ok ? '✓' : '✗'} ${msg}`);
  if (!ok) failures.push(msg);
}

const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();

page.on('pageerror', (e) => pageErrors.push(String(e)));
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  if (EXPECTED_NOISE.some((p) => p.test(m.text()))) return;
  consoleErrors.push(m.text());
});

async function signIn() {
  await page.goto(`${BASE}/auth/login`, { waitUntil: 'networkidle' });
  await page.click('text=Sign in with Email');
  await page.waitForSelector('input[name="email"]', { state: 'visible', timeout: 8000 });
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', 'password12345');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}),
    page.click('button[type="submit"]:visible'),
  ]);
  await page.waitForTimeout(500);
  if (page.url().includes('/auth/stay-signed-in')) {
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}),
      page.click('button[type="submit"]:visible'),
    ]);
    await page.waitForTimeout(500);
  }
  if (page.url().includes('/auth/login')) throw new Error('login failed');
}

async function openSendingSettings() {
  if (!(await page.$('[data-email-settings]'))) {
    await page.click('[data-email-profile-toggle]');
    await page.waitForTimeout(300);
    await page.click('[data-email-profile-action="settings"]');
    await page.waitForTimeout(700);
  }
  const tab = await page.$('[data-email-settings-tabs] [data-tab-key="sending"]');
  if (tab) {
    await tab.click();
    await page.waitForTimeout(400);
  }
}

function toastText() {
  return page.evaluate(() => {
    const t = document.querySelector('[data-email-toast-text]');
    return t ? t.textContent : '';
  });
}

function libraryEntries() {
  return page.evaluate(() => {
    return [...document.querySelectorAll('[data-email-signature-id]')].map((item) => ({
      name: item.querySelector('[data-email-signature-rename]')?.value || '',
      active: item.classList.contains('is-active'),
    }));
  });
}

try {
  step(1, 'Sign in and open the mailbox');
  await signIn();
  await page.goto(`${BASE}/email`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-email-row]', { timeout: 15000 });

  step(2, 'The Sending tab offers a provider-named import button');
  await openSendingSettings();
  const btn = await page.$('[data-email-settings-import-signature]');
  check(!!btn, 'the import button is present');
  const label = btn ? (await btn.textContent()).trim() : '';
  check(label === 'Import from Gmail', `button is named for the provider (saw "${label}")`);
  check(btn ? !(await btn.isDisabled()) : false, 'button is enabled while a mailbox is connected');

  step(3, 'Importing fills the editor from Sent mail');
  await btn.click();
  await page.waitForFunction(
    () => (document.querySelector('[data-email-toast-text]')?.textContent || '')
      .includes('Signature imported'),
    { timeout: 15000 }
  );
  check(true, 'success toast appeared');

  const editorHtml = await page.evaluate(
    () => document.querySelector('[data-email-signature-editor]')?.innerHTML || ''
  );
  check(editorHtml.includes('Vernon Francis'), 'editor carries the signature name');
  check(editorHtml.includes('Managing Director'), 'editor carries the signature role line');
  check(/img[^>]+src="data:image\/png;base64,/.test(editorHtml), 'the logo survived as an inline image');
  check(!editorHtml.includes('One-off footer'), 'the one-off trailer from a single send was not chosen');
  check(!editorHtml.includes('Thanks — attached now'), 'no message body leaked into the signature');
  check(!/<script/i.test(editorHtml), 'no script tags in the imported HTML');

  step(4, 'The library gains one active provider-named entry');
  let entries = await libraryEntries();
  const imported = entries.filter((e) => e.name === 'Default From Gmail');
  check(imported.length === 1, `exactly one "Default From Gmail" entry (saw ${imported.length})`);
  check(imported[0]?.active === true, 'the imported signature is the active one');

  step(5, 'The button recovers after the render');
  const after = await page.$('[data-email-settings-import-signature]');
  const afterLabel = after ? (await after.textContent()).trim() : '';
  check(afterLabel === 'Import from Gmail', `label restored (saw "${afterLabel}")`);
  check(after ? !(await after.isDisabled()) : false, 'button is enabled again');

  step(6, 'The import persisted server-side');
  const prefs = await page.evaluate(async (base) => {
    const r = await fetch(base + '/portal/mail/settings', {
      headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      credentials: 'same-origin',
    }).then((res) => res.json());
    return r.preferences || {};
  }, BASE);
  check(String(prefs.signature || '').includes('Vernon Francis'), 'preferences.signature holds the import');
  const savedNames = (prefs.signatures || []).map((s) => s.name);
  check(savedNames.filter((n) => n === 'Default From Gmail').length === 1,
    `server library holds one imported entry (saw [${savedNames.join(', ')}])`);
  check(prefs.activeSignatureId === (prefs.signatures || [])
    .find((s) => s.name === 'Default From Gmail')?.id,
  'the imported entry is active server-side');

  step(7, 'Re-importing reuses the slot instead of duplicating it');
  await page.evaluate(() => {
    const t = document.querySelector('[data-email-toast-text]');
    if (t) t.textContent = '';
  });
  await page.click('[data-email-settings-import-signature]');
  await page.waitForFunction(
    () => (document.querySelector('[data-email-toast-text]')?.textContent || '')
      .includes('Signature imported'),
    { timeout: 15000 }
  );
  entries = await libraryEntries();
  const again = entries.filter((e) => e.name === 'Default From Gmail');
  check(again.length === 1, `still exactly one imported entry (saw ${again.length})`);

  step(8, 'Compose opens carrying the imported signature');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  await page.click('[data-email-folder="compose"]');
  await page.waitForTimeout(600);
  const composeSig = await page.evaluate(
    () => document.querySelector('[data-email-compose-editor] [data-email-signature]')?.innerHTML
      || document.querySelector('[data-email-signature]')?.innerHTML || ''
  );
  check(composeSig.includes('Vernon Francis'), 'new message body ends with the imported signature');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  step(9, 'A 422 shows its message and releases the button');
  await context.route('**/portal/mail/settings/import-signature', (route) => route.fulfill({
    status: 422,
    contentType: 'application/json',
    body: JSON.stringify({
      message: 'No signature was found in this mailbox yet.',
      signature: null,
    }),
  }));
  await openSendingSettings();
  await page.evaluate(() => {
    const t = document.querySelector('[data-email-toast-text]');
    if (t) t.textContent = '';
  });
  await page.click('[data-email-settings-import-signature]');
  await page.waitForFunction(
    () => (document.querySelector('[data-email-toast-text]')?.textContent || '')
      .includes('No signature was found'),
    { timeout: 15000 }
  );
  check(true, 'the endpoint message reached the toast');
  const failedBtn = await page.$('[data-email-settings-import-signature]');
  const failedLabel = failedBtn ? (await failedBtn.textContent()).trim() : '';
  check(failedLabel === 'Import from Gmail', `label restored after failure (saw "${failedLabel}")`);
  check(failedBtn ? !(await failedBtn.isDisabled()) : false, 'button is clickable again after failure');
  await context.unroute('**/portal/mail/settings/import-signature');

  step(10, 'No page errors during the whole flow');
  check(pageErrors.length === 0, `no uncaught page errors (saw ${pageErrors.length})`);
  check(consoleErrors.length === 0, `no unexpected console errors (saw ${consoleErrors.length})`);
} catch (e) {
  failures.push('threw: ' + e.message);
  log('\n!! ' + e.stack);
} finally {
  log('\n──────── result ────────');
  const errs = [...pageErrors, ...consoleErrors];
  if (errs.length) {
    log('page errors:');
    [...new Set(errs)].slice(0, 10).forEach((e) => log('  ! ' + e));
  }
  if (failures.length) {
    log(`${failures.length} FAILED:`);
    failures.forEach((f) => log('  ✗ ' + f));
  } else {
    log('all checks passed');
  }
  await browser.close();
  process.exit(failures.length ? 1 : 0);
}
