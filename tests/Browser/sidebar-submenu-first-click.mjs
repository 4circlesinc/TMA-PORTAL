/*
 * A submenu must open on the FIRST click.
 *
 * Templates read as dead until you clicked it twice. The cause is not in the
 * toggle, which is a plain aria-expanded flip: it is the hover rail's
 * focusout handler. Clicking a <button> focuses it, and moving focus INTO the
 * sidebar fires focusout on whatever held it before; the handler behind that
 * event runs collapseAllSubnavs() a tick later and closes the group the click
 * had just opened. The second click "works" only because the button already
 * holds focus by then, so no focusout follows it.
 *
 * onHoverRailClosed() guards for the mobile drawer and the standard rail, but
 * the default hover-overlay style on a desktop viewport hits none of them,
 * and isHoverRailOpen() is read a tick later against a rail the pointer may
 * have left.
 *
 * Only a browser has focus, so only a browser catches this.
 */
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';

const BASE = process.env.TMA_BASE || 'http://127.0.0.1:8913';

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1500, height: 950 } });
const page = await context.newPage();
const failures = [];

function check(name, ok, detail) {
  if (ok) console.log(`  ok   ${name}`);
  else {
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
    failures.push(name);
  }
}

page.on('pageerror', (e) => check('no page error', false, e.message));

await page.goto(`${BASE}/auth/login`, { waitUntil: 'domcontentloaded' });
await page.click('text=Sign in with Email');
await page.waitForSelector('input[name="email"]', { state: 'visible', timeout: 8000 });
await page.fill('input[name="email"]', 'e2e@example.com');
await page.fill('input[name="password"]', 'password12345');
await Promise.all([
  page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}),
  page.click('button[type="submit"]:visible'),
]);
await page.waitForTimeout(600);

// New-device email code: MAIL_MAILER=log puts the message in the app log.
if (page.url().includes('/auth/login-code')) {
  const code = execSync(
    `grep -oE '>[0-9]{6}<' storage/logs/laravel.log | tail -1 | tr -d '><'`,
  ).toString().trim();
  if (!/^[0-9]{6}$/.test(code)) throw new Error('could not read the sign-in code');
  await page.click('[data-otp] input:not([type=hidden])').catch(() => {});
  await page.keyboard.type(code, { delay: 40 });
  await page.waitForTimeout(300);
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}),
    page.click('button[type="submit"]:visible'),
  ]);
  await page.waitForTimeout(700);
}

if (page.url().includes('/auth/stay-signed-in')) {
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}),
    page.click('button[type="submit"]:visible'),
  ]);
  await page.waitForTimeout(700);
}
if (page.url().includes('/auth/login')) throw new Error('login failed');
await page.waitForSelector('[data-expand="templates"]', { timeout: 20000 });
await page.waitForTimeout(1200);

// A first sign-in can land with a modal over the shell; the sidebar is
// behind its backdrop and every click would hit the backdrop instead.
for (let i = 0; i < 4; i++) {
  if (!(await page.$('.tma-portal-modal__backdrop'))) break;
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
}
await page.evaluate(() => {
  document.querySelectorAll('.tma-portal-modal').forEach((m) => m.remove());
});
await page.waitForTimeout(200);

const isOpen = (key) =>
  page.evaluate(
    (k) =>
      document.querySelector(`[data-expand="${k}"]`)?.getAttribute('aria-expanded') === 'true' &&
      !document.querySelector(`[data-subnav="${k}"]`)?.hidden,
    key,
  );

/*
 * The real gesture. The pointer travels from the page to the button and
 * clicks once — which is what a person does, and what moves focus into the
 * sidebar for the first time. Parking the mouse elsewhere first is the whole
 * point: it is what makes the focusout land.
 */
for (const key of ['templates', 'workflows', 'people', 'folders']) {
  await page.mouse.move(1400, 500);
  await page.waitForTimeout(150);
  await page.click(`[data-expand="${key}"]`);
  // Longer than the setTimeout(…, 0) the focusout handler defers behind.
  await page.waitForTimeout(400);
  check(`${key} opens on the first click`, await isOpen(key));

  await page.click(`[data-expand="${key}"]`);
  await page.waitForTimeout(400);
  check(`${key} closes again on the next click`, !(await isOpen(key)));
}

/* Tabbing to a group and pressing Enter is the same toggle, keyboard side. */
await page.mouse.move(1400, 500);
await page.focus('[data-expand="templates"]');
await page.keyboard.press('Enter');
await page.waitForTimeout(400);
check('templates opens from the keyboard', await isOpen('templates'));

/* The rail still tidies up when the pointer genuinely leaves the sidebar. */
await page.mouse.move(750, 500);
await page.waitForTimeout(600);
check('an open group survives the pointer moving over the page', await isOpen('templates'));

await browser.close();
console.log(failures.length ? `\n${failures.length} failing` : '\nall passing');
process.exit(failures.length ? 1 : 0);
