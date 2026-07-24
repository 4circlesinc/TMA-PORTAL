import { chromium } from 'playwright';

// Notification toasts and the live right-rail panels.
//
// The toast contract: a notification arriving while the user is in the portal
// pops a card top-right that closes on its own after 10 seconds; hovering it
// holds it open indefinitely; once the pointer leaves it closes 5 seconds
// later. The right rail's Activities panel must show real audit entries (the
// sign-in this very test performs) and the Notifications panel must show
// seeded server rows.
//
// Needs a fresh DB with the base e2e user plus one seeded notification (see
// README). This test spends real wall-clock time on the timers — ~45s.
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
const context = await browser.newContext({ viewport: { width: 1680, height: 950 } });
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

function fireNotification(id, title, message) {
  return page.evaluate(([id, title, message]) => {
    window.TMANotifications.applyRealtime({
      id, title, message,
      type: 'email.received', level: 'info', icon: 'EnvelopeSimple',
      read: false, createdAt: new Date().toISOString(), actionUrl: '/email',
    }, (window.TMANotifications.state.unread || 0) + 1);
  }, [id, title, message]);
}

const toastSel = (id) => `[data-notify-toast-id="${id}"]`;

try {
  step(1, 'Sign in and open the dashboard (right rail present)');
  await signIn();
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-rb-body="activities"]', { timeout: 15000 });

  step(2, 'Activities shows the sign-in this test just performed');
  await page.waitForFunction(
    () => /signed in/i.test((document.querySelector('[data-rb-body="activities"]') || {}).textContent || ''),
    { timeout: 15000 }
  ).catch(() => {});
  const actText = await page.textContent('[data-rb-body="activities"]');
  check(/Test User signed in/i.test(actText), `the login activity is listed (saw: "${actText.trim().slice(0, 120)}...")`);

  step(3, 'Notifications shows the seeded server row');
  await page.waitForFunction(
    () => /Dana/i.test((document.querySelector('[data-rb-body="notifications"]') || {}).textContent || ''),
    { timeout: 15000 }
  ).catch(() => {});
  const notifText = await page.textContent('[data-rb-body="notifications"]');
  check(/New email from Dana/i.test(notifText), 'the seeded notification renders in the panel');

  step(4, 'An arriving notification pops a toast card top-right');
  await fireNotification('t-plain', 'Plain toast', 'Should close on its own');
  await page.waitForSelector(toastSel('t-plain'), { timeout: 3000 });
  const box = await page.locator(toastSel('t-plain')).boundingBox();
  check(!!box && box.x > 1200 && box.y < 300, `it sits top-right (x=${box && Math.round(box.x)}, y=${box && Math.round(box.y)})`);
  const toastText = await page.textContent(toastSel('t-plain'));
  check(toastText.includes('Plain toast') && toastText.includes('Should close on its own'), 'it carries the title and message');
  await page.screenshot({ path: 'tests/Browser/notify-toasts-toast.png' });

  step(5, 'Unhovered, it is still there at 8.5s and gone by ~11.5s');
  await page.waitForTimeout(8500);
  check(!!(await page.$(toastSel('t-plain'))), 'still visible at 8.5 seconds');
  const closed = await page.waitForSelector(toastSel('t-plain'), { state: 'detached', timeout: 4000 })
    .then(() => true).catch(() => false);
  check(closed, 'closed on its own shortly after 10 seconds');

  step(6, 'Hovering holds it open past 10s; leaving closes it ~5s later');
  await fireNotification('t-hover', 'Hover toast', 'Should wait for the pointer');
  await page.waitForSelector(toastSel('t-hover'), { timeout: 3000 });
  await page.hover(toastSel('t-hover'));
  await page.waitForTimeout(12000);
  check(!!(await page.$(toastSel('t-hover'))), 'still open after 12 seconds under the pointer');
  await page.mouse.move(200, 500);
  await page.waitForTimeout(3500);
  check(!!(await page.$(toastSel('t-hover'))), 'still open 3.5 seconds after the pointer left');
  const closedAfterLeave = await page.waitForSelector(toastSel('t-hover'), { state: 'detached', timeout: 4000 })
    .then(() => true).catch(() => false);
  check(closedAfterLeave, 'closed about 5 seconds after the pointer left');

  step(7, 'The close button dismisses immediately, and a repeat id never re-toasts');
  await fireNotification('t-close', 'Closable toast', '');
  await page.waitForSelector(toastSel('t-close'), { timeout: 3000 });
  await page.click(`${toastSel('t-close')} [data-notify-toast-close]`);
  const closedByButton = await page.waitForSelector(toastSel('t-close'), { state: 'detached', timeout: 2000 })
    .then(() => true).catch(() => false);
  check(closedByButton, 'the X closes it');

  await page.evaluate(() => {
    window.TMAToast.showNotificationToast({ id: 't-close', title: 'Closable toast' });
  });
  await page.waitForTimeout(600);
  check(!(await page.$(toastSel('t-close'))), 'the same notification id does not toast twice');

  step(8, 'The bell badge follows the arrivals');
  const unread = await page.evaluate(() => window.TMANotifications.state.unread);
  check(unread >= 3, `unread count moved with the arrivals (${unread})`);

  await page.screenshot({ path: 'tests/Browser/notify-toasts-final.png' });
} catch (e) {
  failures.push(`fatal: ${e.message}`);
  await page.screenshot({ path: 'tests/Browser/notify-toasts-error.png' }).catch(() => {});
}

const relevantErrors = errors.filter((e) =>
  !e.includes('401') && !e.includes('409') && !e.includes('502') && !e.includes('Failed to load resource')
  && !e.includes('realtime disabled') && !e.includes('WebSocket')
);

log(`\n${failures.length === 0 ? 'PASS' : 'FAIL'} — ${failures.length} failure(s)`);
failures.forEach((f) => log(`  ✗ ${f}`));
if (relevantErrors.length) {
  log('\nConsole/page errors:');
  relevantErrors.forEach((e) => log(`  ! ${e}`));
}

await browser.close();
process.exit(failures.length === 0 && relevantErrors.length === 0 ? 0 : 1);
