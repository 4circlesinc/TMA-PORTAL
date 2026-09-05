import { chromium } from 'playwright';

/*
 * Swipe to open and close the mobile drawers: the mailbox's on Email, the
 * main menu everywhere else. A drag that starts on the left edge opens the
 * drawer, a drag to the left on the open drawer (or its scrim) closes it,
 * and while the finger is down the drawer follows it. A scroll must never
 * be mistaken for a swipe, and the mailbox's own row swipes (archive to
 * the right, delete to the left) keep working away from the edge.
 *
 * Touches are synthesised as TouchEvents because Playwright's touchscreen
 * only taps; the gesture code listens to touchstart/move/end, so a
 * dispatched sequence is the same input.
 *
 * See README.md for setup. Uses the mailbox fixture.
 */
const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8899';
const EMAIL = process.env.TMA_STAFF_EMAIL || 'e2e@example.com';

const log = (...a) => console.log(...a);
const failures = [];
function step(n, msg) { log(`\n[${n}] ${msg}`); }
function check(ok, msg) {
  log(`    ${ok ? '✓' : '✗'} ${msg}`);
  if (!ok) failures.push(msg);
}

const NOISE = [/409/, /WebSocket|ws:\/\/|wss:\/\//i, /Failed to load resource/, /net::ERR/, /reconnect/i, /reverb|pusher/i];
const real = (errors) => errors.filter((t) => !NOISE.some((re) => re.test(t)));

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 2,
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
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
  await page.waitForTimeout(400);
  if (page.url().includes('/auth/stay-signed-in')) {
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}),
      page.click('button[type="submit"]:visible'),
    ]);
    await page.waitForTimeout(400);
  }
  if (page.url().includes('/auth/login')) throw new Error('login failed');
}

/* One finger, from `from` to `to`, in `steps` moves. `hold` leaves the
   finger down (no touchend) so mid-drag state can be read. */
function touch(from, to, opts = {}) {
  return page.evaluate(({ from, to, steps, hold }) => {
    const target = document.elementFromPoint(from.x, from.y) || document.body;
    const mk = (type, x, y) => {
      const t = new Touch({ identifier: 7, target, clientX: x, clientY: y, pageX: x, pageY: y });
      const ended = type === 'touchend';
      return new TouchEvent(type, {
        touches: ended ? [] : [t], targetTouches: ended ? [] : [t], changedTouches: [t],
        bubbles: true, cancelable: true, composed: true,
      });
    };
    target.dispatchEvent(mk('touchstart', from.x, from.y));
    for (let i = 1; i <= steps; i += 1) {
      target.dispatchEvent(mk('touchmove', from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps));
    }
    if (!hold) target.dispatchEvent(mk('touchend', to.x, to.y));
    return target.tagName + (target.className ? '.' + String(target.className).split(' ')[0] : '');
  }, { from, to, steps: opts.steps || 8, hold: !!opts.hold });
}
function release(at) {
  return page.evaluate(({ at }) => {
    const target = document.elementFromPoint(at.x, at.y) || document.body;
    const t = new Touch({ identifier: 7, target, clientX: at.x, clientY: at.y, pageX: at.x, pageY: at.y });
    target.dispatchEvent(new TouchEvent('touchend', { touches: [], targetTouches: [], changedTouches: [t], bubbles: true, cancelable: true, composed: true }));
  }, { at });
}

const mailOpen = () => page.$('.tma-dash__email-sidebar--open').then((el) => !!el);
const navOpen = () => page.evaluate(() => document.querySelector('.tma-dash').classList.contains('is-nav-open'));
const settle = () => page.waitForTimeout(450);

try {
  step(1, 'Email: a drag from the left edge opens the mailbox drawer');
  await signIn();
  await page.goto(`${BASE}/email`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.tma-dash__email-row[data-email-row]', { timeout: 15000 });
  check(!(await mailOpen()), 'it starts closed');

  // Held mid-drag: the drawer must be following the finger.
  await touch({ x: 6, y: 420 }, { x: 120, y: 424 }, { hold: true });
  const midDrag = await page.$eval('.tma-dash__email-sidebar', (el) => ({ transform: el.style.transform, transition: el.style.transition }));
  check(/translateX\(-\d+px\)/.test(midDrag.transform), `it follows the finger while held (${midDrag.transform || 'no inline transform'})`);
  check(midDrag.transition === 'none', 'without its transition fighting the drag');
  await release({ x: 120, y: 424 });
  await settle();
  check(await mailOpen(), 'and opens once the finger lets go past the commit point');
  const after = await page.$eval('.tma-dash__email-sidebar', (el) => el.style.transform + '|' + el.style.transition);
  check(after === '|', 'the inline drag styles are gone afterwards');

  step(2, 'Email: a drag to the left closes it');
  await touch({ x: 220, y: 500 }, { x: 40, y: 504 });
  await settle();
  check(!(await mailOpen()), 'the drawer closed');

  step(3, 'A short or vertical move is not a swipe');
  await touch({ x: 6, y: 420 }, { x: 30, y: 422 });
  await settle();
  check(!(await mailOpen()), 'a nudge under the commit distance does nothing');
  await touch({ x: 6, y: 300 }, { x: 40, y: 520 });
  await settle();
  check(!(await mailOpen()), 'a scroll that drifts sideways does nothing');
  await touch({ x: 200, y: 420 }, { x: 320, y: 424 });
  await settle();
  check(!(await mailOpen()), 'a drag that starts away from the edge does nothing');

  step(4, 'Email: the scrim closes on a drag too, and rows still swipe away from the edge');
  await touch({ x: 6, y: 420 }, { x: 160, y: 424 });
  await settle();
  check(await mailOpen(), 'opened again from the edge');
  await touch({ x: 340, y: 500 }, { x: 150, y: 504 });
  await settle();
  check(!(await mailOpen()), 'a drag to the left on the scrim closed it');
  // Real pointer input (the row captures the pointer, which a synthetic
  // PointerEvent cannot satisfy). A press-and-nudge is a drag that snaps
  // back, never a tap that opens the message.
  const rowBox = await page.$eval('[data-email-row-swipe-track]', (el) => {
    const r = el.getBoundingClientRect();
    return { top: r.top, left: r.left };
  });
  const rowY = rowBox.top + 12;
  async function pressRow(x) {
    await page.mouse.move(x, rowY);
    await page.mouse.down();
    await page.mouse.move(x + 12, rowY, { steps: 3 });
    const dragging = await page.$eval('[data-email-row-swipe]', (el) => el.classList.contains('is-dragging'));
    await page.mouse.up();
    await page.waitForTimeout(150);
    return dragging;
  }
  check((await pressRow(8)) === false, 'a row does not start its own swipe from the edge strip');
  check((await pressRow(120)) === true, 'but still does from inside the row');
  check(!(await page.$('.tma-dash--email-mobile-reading')), 'and neither press opened the message');

  step(5, 'Dashboard: the same gestures drive the main menu drawer');
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  check(!(await navOpen()), 'it starts closed');
  await touch({ x: 6, y: 420 }, { x: 150, y: 424 });
  await settle();
  check(await navOpen(), 'a drag from the edge opens it');
  await touch({ x: 200, y: 500 }, { x: 30, y: 504 });
  await settle();
  check(!(await navOpen()), 'a drag to the left closes it');

  step(6, 'No page errors');
  const bad = real(errors);
  check(bad.length === 0, bad.length ? 'console: ' + bad.join(' | ') : 'clean console');
} catch (e) {
  failures.push('threw: ' + e.message);
  log(e.stack);
}

await browser.close();
if (failures.length) {
  log('\nFAILED:\n - ' + failures.join('\n - '));
  process.exit(1);
}
log('\nAll checks passed.');
