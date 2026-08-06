import { chromium } from 'playwright';

// Account settings → Security. PHPUnit covers the endpoints
// (tests/Feature/SecuritySettingsTest.php); what only a browser can check is
// that the panels are *wired* — the page used to render a phone box, four
// notification switches and an empty column beside every session, none of
// which reached the server. It also pins the section headings being wordmarks
// rather than icon+text, which was a deliberate design change.
//
// See README.md for setup. Needs the standard e2e@example.com account and
// SESSION_DRIVER=database — with any other driver the sessions table is empty
// and step 6 has nothing to sign out. Set TMA_DB to the sqlite file to include
// the "set a password" step, which needs an account flipped to password_auto.
const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8899';
const EMAIL = process.env.TMA_STAFF_EMAIL || 'e2e@example.com';
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
  // Sign-in lands on the "stay signed in?" gate before the portal.
  if (page.url().includes('/auth/stay-signed-in')) {
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}),
      page.click('text=Yes, stay signed in'),
    ]);
    await page.waitForTimeout(500);
  }
  if (page.url().includes('/auth/login')) throw new Error('login failed for ' + email);
}

// Read the page's own feed, so persistence checks don't depend on how a
// panel happens to render.
const secData = (page) => page.evaluate(async (base) => fetch(base + '/security-settings/data', {
  headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
  credentials: 'same-origin',
}).then((r) => r.json()), BASE);

async function openSecurity(page) {
  await page.goto(`${BASE}/account-settings?settings-page=account-security`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#sec-password', { timeout: 10000 });
  await page.waitForTimeout(400);
}

const page = await browser.newPage();
page.on('console', (m) => {
  if (m.type() === 'error' && !/403|404/.test(m.text())) errors.push('console: ' + m.text());
});
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

try {
  step(1, 'Logging in and opening Account settings → Security');
  await signIn(page, EMAIL);
  await openSecurity(page);
  check(await page.locator('#sec-phone').isVisible(), 'the Security page painted');

  step(2, 'Section headings carry no icon');
  const headingImgs = await page.locator('.tma-security__title img').count();
  check(headingImgs === 0, `no <img> inside any section heading (found ${headingImgs})`);
  // The brand marks beside Google/Microsoft are a different thing and stay.
  check(await page.locator('.tma-security__row-ico img').count() > 0,
    'provider rows keep their brand marks');

  step(3, 'Adding a phone number saves it to the server');
  await page.click('[data-dialog-open="#phone-dialog"]');
  await page.waitForSelector('#phone-dialog input[name="phone"]', { state: 'visible' });
  await page.fill('#phone-dialog input[name="phone"]', 'not a phone');
  await page.click('#phone-dialog button[type="submit"]');
  await page.waitForTimeout(700);
  check(await page.locator('#phone-dialog [data-sec-error]').isVisible(),
    'a number that isn\'t one is refused with a message, not silently accepted');

  await page.fill('#phone-dialog input[name="phone"]', '+1 246 555 0134');
  await page.click('#phone-dialog button[type="submit"]');
  await page.waitForTimeout(1200);
  // Compare digits: the portal's tel inputs re-format as you type, so the
  // stored string is the mask's ("+1 246 555-0134"), not what was typed.
  const digits = (s) => (s || '').replace(/\D/g, '');
  let data = await secData(page);
  check(digits(data.phone) === '12465550134', `the number reached the server (${data.phone})`);
  const phoneCard = () => page.locator('#sec-phone').locator('xpath=../..').innerText();
  check(digits(await phoneCard()).includes('12465550134'),
    'the panel shows the saved number instead of the empty state');

  step(4, 'It survives a reload, then can be removed');
  await openSecurity(page);
  check(digits(await phoneCard()).includes('12465550134'), 'still there after a full reload');
  page.once('dialog', (d) => d.accept());
  await page.click('[data-sec-phone-remove]');
  await page.waitForTimeout(1200);
  data = await secData(page);
  check(data.phone === null, 'removing it clears the number on the server');

  step(5, 'The security notification switches persist');
  await openSecurity(page);
  check(await page.locator('[data-sec-alert="new_device"]').isDisabled(),
    'the new-device alert stays locked on');

  // Assert each switch *flips* what the server holds, rather than assuming a
  // starting value — a re-run inherits whatever the last one left behind.
  const flip = async (key) => {
    const before = (await secData(page)).alerts[key];
    check(await page.locator(`[data-sec-alert="${key}"]`).isChecked() === before,
      `${key} paints the value the server holds (${before})`);
    await page.click(`[data-sec-alert="${key}"] + .tma-auth__switch-ui`);
    await page.waitForTimeout(1000);
    const after = (await secData(page)).alerts[key];
    check(after === !before, `${key} flipped to ${!before} and saved`);
    return after;
  };
  const monthly = await flip('monthly_summary');
  const passwordAlert = await flip('password_changed');

  await openSecurity(page);
  check(await page.locator('[data-sec-alert="monthly_summary"]').isChecked() === monthly,
    'the saved state is what the page paints after a reload');
  check(await page.locator('[data-sec-alert="password_changed"]').isChecked() === passwordAlert,
    'the other switch kept its saved value too');
  check((await secData(page)).alerts.new_device === true,
    'the locked alert is still on after all that');

  step(6, 'Another session can be signed out from the sessions table');
  // Sign the same account in from a second, independent browser so there is a
  // real second session to end — seeding one by hand doesn't survive session
  // garbage collection.
  const second = await browser.newContext();
  const secondPage = await second.newPage();
  await signIn(secondPage, EMAIL);
  await secondPage.goto(`${BASE}/`, { waitUntil: 'networkidle' });

  await openSecurity(page);
  const before = (await secData(page)).sessions.length;
  check(before >= 2, `the second browser shows up as a session (${before} listed)`);
  check(await page.locator('tr:has-text("This device") [data-sec-session-revoke]').count() === 0,
    'the session you are using is not offered a Sign out button');
  const revoke = page.locator('[data-sec-session-revoke]').first();
  check(await revoke.count() > 0, 'other sessions do offer one');
  await revoke.click();
  await page.waitForTimeout(1400);
  const after = (await secData(page)).sessions.length;
  check(after === before - 1, `one session ended (${before} → ${after})`);

  // And it's really ended: the other browser is bounced back to sign-in.
  await secondPage.goto(`${BASE}/account-settings`, { waitUntil: 'networkidle' });
  check(secondPage.url().includes('/auth/login'),
    'the signed-out browser lands back on the login page');
  await second.close();

  step(7, 'An account with no password of its own is offered one');
  // Accounts created by an administrator, or through Google/Microsoft, carry a
  // random password nobody has seen — "Change password" can never work for
  // them, so the panel has to offer "Set a password" instead. Flip the flag
  // through the API-facing DB the same way those accounts arrive.
  if (process.env.TMA_DB) {
    const { execFileSync } = await import('node:child_process');
    const sql = (q) => execFileSync('sqlite3', [process.env.TMA_DB, q]).toString().trim();
    const originalHash = sql("SELECT password FROM users WHERE email = '" + EMAIL + "'");
    sql("UPDATE users SET password_auto = 1 WHERE email = '" + EMAIL + "'");
    await openSecurity(page);
    check(await page.locator('[data-dialog-open="#set-password-dialog"]').isVisible(),
      'the panel offers "Set a password", not "Change password"');
    await page.click('[data-dialog-open="#set-password-dialog"]');
    await page.waitForSelector('#set-password-dialog input[name="password"]', { state: 'visible' });
    await page.fill('#set-password-dialog input[name="password"]', 'short');
    await page.fill('#set-password-dialog input[name="password_confirmation"]', 'short');
    await page.click('#set-password-dialog button[type="submit"]');
    await page.waitForTimeout(900);
    check(await page.locator('#set-password-dialog [data-sec-error]').isVisible(),
      'a password that fails the firm\'s policy is refused');

    // Not the harness password: the policy runs the HIBP breached-password
    // check, and "password12345" is in every breach corpus there is.
    const fresh = 'brisk-lantern-quay-' + Date.now();
    await page.fill('#set-password-dialog input[name="password"]', fresh);
    await page.fill('#set-password-dialog input[name="password_confirmation"]', fresh);
    await page.click('#set-password-dialog button[type="submit"]');
    await page.waitForTimeout(1600);
    check(sql("SELECT password_auto FROM users WHERE email = '" + EMAIL + "'") === '0',
      'the account now has a password of its own');
    check(await page.locator('[data-dialog-open="#change-password-dialog"]').isVisible(),
      'and the panel goes back to offering "Change password"');

    // Put the harness password back so the script can be re-run.
    sql("UPDATE users SET password = '" + originalHash + "' WHERE email = '" + EMAIL + "'");
  } else {
    log('    – skipped (set TMA_DB to the sqlite file to run this step)');
  }

  step(8, 'The page never navigated away while doing all that');
  check(page.url().includes('/account-settings'), 'still on Account settings');

  await page.screenshot({ path: new URL('security-settings.png', import.meta.url).pathname, fullPage: true });
} catch (e) {
  failures.push('threw: ' + e.message);
  log('\n!! ' + e.stack);
} finally {
  await browser.close();
}

if (errors.length) {
  log('\nPage errors:');
  errors.forEach((e) => log('  ' + e));
}
log(`\n${failures.length ? '✗ ' + failures.length + ' failure(s)' : '✓ all checks passed'}`);
failures.forEach((f) => log('  - ' + f));
process.exit(failures.length ? 1 : 0);
