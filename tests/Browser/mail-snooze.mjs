import { chromium } from 'playwright';
import { execSync } from 'child_process';

// Snooze as a reminder: the hover clock opens a picker, snoozing hides the
// row into the Snoozed view, unsnoozing brings it back, and when the wake
// pass runs the reminder notification is created (and toastable).
//
// Needs the mailbox fixture (connected account + at least one inbox message).
// Optional: TMA_DB=/path/to.sqlite so the wake-pass step can force a due
// snooze and run `php artisan mail:wake-snoozed` against the same DB the
// server is using.
const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8899';
const EMAIL = process.env.TMA_STAFF_EMAIL || 'e2e@example.com';
const DB = process.env.TMA_DB || '';
const log = (...a) => console.log(...a);
const failures = [];
const errors = [];

function step(n, msg) { log(`\n[${n}] ${msg}`); }
function check(ok, msg) {
  log(`    ${ok ? '✓' : '✗'} ${msg}`);
  if (!ok) failures.push(msg);
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1680, height: 950 } });
const page = await context.newPage();
page.on('pageerror', (e) => errors.push(String(e)));

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
  if (page.url().includes('/auth/login')) throw new Error('login failed');
}

try {
  step(1, 'Open the mailbox');
  await signIn();
  await page.goto(`${BASE}/email`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-email-folder="inbox"]', { timeout: 20000 });
  await page.waitForSelector('[data-email-row]', { timeout: 20000 });

  step(2, 'Snoozed sits in the sidebar under Important');
  const folders = await page.$$eval('[data-email-folder]', (els) =>
    els.map((el) => el.getAttribute('data-email-folder')));
  const inboxAt = folders.indexOf('inbox');
  const importantAt = folders.indexOf('important');
  const snoozedAt = folders.indexOf('snoozed');
  check(snoozedAt !== -1, 'Snoozed menu item exists');
  check(snoozedAt === importantAt + 1 || snoozedAt === inboxAt + 2, 'Snoozed is near Important / Inbox');

  const firstRow = page.locator('[data-email-row]').first();
  const messageId = await firstRow.getAttribute('data-email-row');
  const subject = (await firstRow.locator('.tma-dash__email-row-subject, [data-email-subject]').first().textContent().catch(() => ''))
    || (await firstRow.textContent());

  step(3, 'Hover snooze opens the picker with short presets');
  await firstRow.hover();
  await page.waitForTimeout(400);
  const snoozeBtn = `[data-email-row-hover="snooze"][data-email-row-id="${messageId}"]`;
  await page.waitForSelector(snoozeBtn, { timeout: 5000 });
  await page.$eval(snoozeBtn, (el) => el.click());
  await page.waitForSelector('[data-email-snooze-menu]', { timeout: 5000 });
  const menuText = await page.textContent('[data-email-snooze-menu]');
  check(/In 15 minutes/i.test(menuText), 'has "In 15 minutes"');
  check(/In 1 hour/i.test(menuText), 'has "In 1 hour"');
  check(/Tomorrow/i.test(menuText), 'has "Tomorrow"');

  step(4, 'Picking a preset snoozes the row out of Inbox');
  await page.click('[data-email-snooze-preset]');
  await page.waitForFunction(
    (id) => !document.querySelector(`[data-email-row="${id}"]`),
    messageId,
    { timeout: 8000 }
  ).catch(() => {});
  check(!(await page.$(`[data-email-row="${messageId}"]`)), 'row left the inbox list');

  step(5, 'Snoozed view lists it with a clock marker');
  await page.click('[data-email-folder="snoozed"]');
  await page.waitForSelector(`[data-email-row="${messageId}"]`, { timeout: 10000 });
  const snoozedRow = page.locator(`[data-email-row="${messageId}"]`);
  check(!!(await snoozedRow.count()), 'row appears in Snoozed');
  check(!!(await page.$(`[data-email-row="${messageId}"] .tma-dash__email-row-snoozed`)), 'clock marker is visible');

  step(6, 'Unsnooze returns it to Inbox');
  await snoozedRow.hover();
  await page.waitForTimeout(400);
  await page.$eval(snoozeBtn, (el) => el.click());
  await page.waitForFunction(
    (id) => !document.querySelector(`[data-email-row="${id}"]`),
    messageId,
    { timeout: 8000 }
  ).catch(() => {});
  await page.click('[data-email-folder="inbox"]');
  await page.waitForSelector(`[data-email-row="${messageId}"]`, { timeout: 10000 });
  check(!!(await page.$(`[data-email-row="${messageId}"]`)), 'row is back in Inbox');

  if (DB) {
    step(7, 'Wake pass sends the reminder notification');
    // Re-snooze via API to a near-future time, then force it due in the DB
    // and run the scheduled wake command against the same SQLite file.
    const until = new Date(Date.now() + 10 * 60e3).toISOString();
    const patch = await page.evaluate(async ([id, iso]) => {
      const m = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);
      const res = await fetch('/portal/mail/messages/' + encodeURIComponent(id), {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
          'X-XSRF-TOKEN': m ? decodeURIComponent(m[1]) : '',
        },
        body: JSON.stringify({ snooze: iso }),
      });
      return { ok: res.ok, status: res.status };
    }, [messageId, until]);
    check(patch.ok, `re-snooze API ok (${patch.status})`);

    execSync(
      `sqlite3 "${DB}" "UPDATE mail_messages SET snoozed_until = datetime('now', '-2 minutes') WHERE uuid = '${messageId}';"`,
      { stdio: 'inherit' }
    );
    execSync(
      `DB_CONNECTION=sqlite DB_DATABASE="${DB}" DB_URL= php artisan mail:wake-snoozed`,
      { stdio: 'inherit', cwd: process.cwd() }
    );

    const notif = execSync(
      `sqlite3 "${DB}" "SELECT title FROM portal_notifications WHERE type = 'email.snooze_due' ORDER BY id DESC LIMIT 1;"`,
      { encoding: 'utf8' }
    ).trim();
    check(/Reminder:/i.test(notif), `wake created reminder notification (got: "${notif}")`);

    // Simulate the realtime arrival so the toast path is exercised too.
    await page.evaluate((title) => {
      window.TMANotifications.applyRealtime({
        id: 'snooze-wake-toast',
        type: 'email.snooze_due',
        title: title || 'Reminder: snoozed email',
        message: 'Back in your inbox',
        level: 'reminder',
        icon: 'ClockCountdown',
        read: false,
        actionUrl: '/email',
        createdAt: new Date().toISOString(),
      }, (window.TMANotifications.state.unread || 0) + 1);
    }, notif);
    await page.waitForSelector('[data-notify-toast-id="snooze-wake-toast"]', { timeout: 5000 });
    check(!!(await page.$('[data-notify-toast-id="snooze-wake-toast"]')), 'reminder toast appears');
  } else {
    step(7, 'Wake pass (skipped — set TMA_DB to exercise it)');
    check(true, 'skipped');
  }

  await page.screenshot({ path: 'tests/Browser/mail-snooze-final.png' });
  log(`\nSubject under test: ${String(subject).trim().slice(0, 80)}`);
} catch (e) {
  failures.push(`fatal: ${e.message}`);
  await page.screenshot({ path: 'tests/Browser/mail-snooze-error.png' }).catch(() => {});
}

log(`\n${failures.length === 0 ? 'PASS' : 'FAIL'} — ${failures.length} failure(s)`);
failures.forEach((f) => log(`  ✗ ${f}`));

await browser.close();
process.exit(failures.length === 0 ? 0 : 1);
