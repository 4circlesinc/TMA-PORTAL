import { chromium } from 'playwright';
import { execSync } from 'node:child_process';

// The mailbox sync progress panel and the mailbox-only sign-out.
//
// Drives the email page against a real server while the seeded
// mail_sync_progress row is mutated underneath it (via sqlite), the way the
// queue jobs would in production: importing → stalled → retried → failed →
// completed. Then signs the mailbox out and checks the provider account
// survives it. Needs the seed described in README.md (a microsoft
// ConnectedAccount plus a running progress row) and TMA_E2E_DB pointing at
// the sqlite database so state can be flipped mid-run.
const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8899';
const EMAIL = process.env.TMA_STAFF_EMAIL || 'e2e@example.com';
const DB = process.env.TMA_E2E_DB;
const log = (...a) => console.log(...a);
const failures = [];
const errors = [];

function step(n, msg) { log(`\n[${n}] ${msg}`); }
function check(ok, msg) {
  log(`    ${ok ? '✓' : '✗'} ${msg}`);
  if (!ok) failures.push(msg);
}
function sql(statement) {
  execSync(`sqlite3 "${DB}" "${statement.replace(/"/g, '\\"')}"`);
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

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
  if (page.url().includes('/auth/login')) throw new Error('login failed');
}

const panelText = async () => (await page.textContent('.tma-mail-sync').catch(() => '')) || '';

try {
  if (!DB) throw new Error('TMA_E2E_DB must point at the sqlite database');

  step(1, 'Sign in and open the mailbox');
  await signIn();
  await page.goto(`${BASE}/email?notice=mail-connected`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-email-row]', { timeout: 15000 });

  step(2, 'The OAuth return notice becomes a confirmation toast and leaves the URL');
  await page.waitForTimeout(700);
  const toast = await page.textContent('body');
  check(toast.includes('Mailbox connected successfully'), 'confirmation toast shown');
  check(!page.url().includes('notice='), `notice stripped from the URL (${page.url()})`);

  step(3, 'The progress panel shows the stage, real counts and the estimate label');
  // The seed's heartbeat has aged while the browser started up, which the
  // watchdog correctly flags as delayed — freshen it so the running state is
  // what gets asserted here (the stalled state is step 4's job).
  sql("update mail_sync_progress set last_progress_at = datetime('now'), status = 'running', current_stage = 'importing'");
  await page.waitForSelector('.tma-mail-sync', { timeout: 10000 });
  await page.waitForFunction(
    () => (document.querySelector('.tma-mail-sync') || {}).textContent?.includes('Importing messages'),
    null, { timeout: 15000 }
  );
  let text = await panelText();
  check(text.includes('Importing messages'), 'stage label is "Importing messages"');
  check(text.includes('Step 7 of 10'), 'step counter shows 7 of 10');
  check(text.includes('1,250 of ~8,420 messages'), `messages counted with the ~ estimate marker (saw: ${text.slice(0, 120)})`);
  check(text.includes('Inbox —'), 'names the folder being imported');
  check(text.includes('15%'), 'shows the real percentage');
  check(text.includes('3,180 conversations'), 'conversation total shown');
  check(text.includes('1,245 attachments (est.)'), 'attachment estimate shown and labelled');
  check(text.includes('680 images'), 'image count shown');
  check(text.includes('565 documents'), 'document count shown');
  check(/about .* left|under 1 min left/.test(text), 'a measured time estimate is offered');
  check(text.includes('updated '), 'shows when the last update landed');
  check(text.includes('you can keep using the portal'), 'says the user is free to leave');

  step(4, 'A run with no heartbeat is flagged as delayed, with a Retry action');
  sql("update mail_sync_progress set last_progress_at = datetime('now', '-120 seconds')");
  await page.waitForFunction(
    () => (document.querySelector('.tma-mail-sync') || {}).textContent?.includes('Mailbox sync delayed'),
    null, { timeout: 15000 }
  );
  text = await panelText();
  check(text.includes('Mailbox sync delayed'), 'panel switches to the delayed state');
  check(text.includes('No progress for a little while'), 'explains what is happening');
  check(!!(await page.$('.tma-mail-sync [data-mail-sync-action="retry"]')), 'offers a manual Retry');

  step(5, 'Manual retry resumes the run');
  await page.click('.tma-mail-sync [data-mail-sync-action="retry"]');
  await page.waitForFunction(
    () => (document.querySelector('.tma-mail-sync') || {}).textContent?.includes('Importing messages'),
    null, { timeout: 15000 }
  );
  check((await panelText()).includes('Importing messages'), 'panel returns to the importing stage');

  step(6, 'A failed run shows the actual reason, not "Something went wrong"');
  sql("update mail_sync_progress set status = 'failed', error_code = 'rate-limit', error_message = 'Microsoft is rate-limiting this mailbox. The import pauses and resumes automatically.'");
  await page.waitForFunction(
    () => (document.querySelector('.tma-mail-sync') || {}).textContent?.includes('Mailbox sync problem'),
    null, { timeout: 20000 }
  );
  text = await panelText();
  check(text.includes('rate-limiting this mailbox'), 'the specific failure reason is shown');
  check(!!(await page.$('.tma-mail-sync [data-mail-sync-action="retry"]')), 'failure state offers Retry');

  step(7, 'Completion is announced and the panel clears itself');
  sql("update mail_sync_progress set status = 'completed', current_stage = 'done', percentage = 100, error_code = null, error_message = null, completed_at = datetime('now'), last_progress_at = datetime('now')");
  sql("update connected_accounts set mail_backfilled_at = datetime('now')");
  await page.waitForFunction(
    () => (document.querySelector('.tma-mail-sync') || {}).textContent?.includes('Mailbox up to date'),
    null, { timeout: 20000 }
  );
  check(true, 'panel reports "Mailbox up to date"');
  await page.waitForSelector('.tma-mail-sync', { state: 'detached', timeout: 12000 });
  check(true, 'panel removes itself after finishing');

  step(8, 'The connect link returns to the email page, not a settings page');
  const connectUrl = await page.evaluate(() => window.TMAEmailAPI.connectUrl('microsoft'));
  check(connectUrl.includes('return=email'), `connect URL carries return=email (${connectUrl})`);

  step(9, 'Mailbox sign-out keeps the provider account connected to the portal');
  await page.click('[data-email-profile-toggle]');
  await page.waitForTimeout(300);
  await page.click('[data-email-profile-action="sign-out"]');
  await page.waitForFunction(
    () => document.body.textContent.includes('No mailbox connected'),
    null, { timeout: 10000 }
  );
  check(true, 'email page returns to the connect state');
  const bodyText = await page.textContent('body');
  check(bodyText.includes('still connected to the portal'),
    'the toast says the provider account was not disconnected');

  // The provider account must survive with only mail sync switched off.
  const settings = await page.evaluate(async (base) => {
    const r = await fetch(base + '/portal/mail/settings', {
      headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      credentials: 'same-origin',
    });
    return r.json();
  }, BASE);
  const ms = (settings.accounts || []).filter((a) => a.provider === 'microsoft')[0];
  check(!!ms, 'the Microsoft account is still connected to the portal');
  check(ms && ms.syncEnabled === false, 'only mail sync was turned off');

  const kept = execSync(`sqlite3 "${DB}" "select count(*) from mail_messages"`).toString().trim();
  check(kept === '12', `imported mail survives the sign-out (${kept} rows kept)`);
} catch (e) {
  failures.push('threw: ' + e.message);
  log('\n!! ' + e.stack);
} finally {
  log('\n──────── result ────────');
  if (errors.length) {
    log('page errors:');
    [...new Set(errors)].slice(0, 10).forEach((er) => log('  ! ' + er));
  }
  if (failures.length) {
    log(`${failures.length} FAILED:`);
    failures.forEach((f) => log('  ✗ ' + f));
  } else {
    log('all checks passed');
  }
  await page.screenshot({ path: 'tests/Browser/mail-sync-progress.png', fullPage: false }).catch(() => {});
  await browser.close();
  process.exit(failures.length ? 1 : 0);
}
