import { chromium } from 'playwright';

// Phase-1 recipient typeahead on compose To/Cc/Bcc.
//
// Typing in To should surface organization staff, clients, and prior-mail
// addresses; picking a row inserts "Name <email>" without a full re-render
// wiping the caret. Needs a staff user, a colleague, a client, and one prior
// mail message (see README).
const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8899';
const EMAIL = process.env.TMA_STAFF_EMAIL || 'e2e@example.com';
const log = (...a) => console.log(...a);
const failures = [];

function step(n, msg) { log(`\n[${n}] ${msg}`); }
function check(ok, msg) {
  log(`    ${ok ? '✓' : '✗'} ${msg}`);
  if (!ok) failures.push(msg);
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1680, height: 950 } });
const page = await context.newPage();

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
  step(1, 'Open email and start a new compose');
  await signIn();
  await page.goto(`${BASE}/email`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-email-folder="compose"], [data-email-compose], button:has-text("Compose")', { timeout: 20000 });

  // Prefer the sidebar Compose item; fall back to any compose trigger.
  if (await page.$('[data-email-folder="compose"]')) {
    await page.click('[data-email-folder="compose"]');
  } else {
    await page.click('button:has-text("Compose")');
  }
  await page.waitForSelector('[data-email-compose-field="to"]', { timeout: 10000 });

  step(2, 'Typing a colleague name opens the suggest menu');
  const to = page.locator('[data-email-compose-field="to"]').first();
  await to.click();
  await to.fill('');
  await to.type('Dana', { delay: 40 });
  await page.waitForSelector('[data-email-suggest-menu]', { timeout: 8000 });
  const menuText = await page.textContent('[data-email-suggest-menu]');
  check(/Dana Reed/i.test(menuText), 'staff suggestion shows the colleague name');
  check(/dana@example\.com/i.test(menuText) || /Organization/i.test(menuText), 'staff suggestion shows email or Organization source');

  step(3, 'Picking a suggestion fills To with Name <email>');
  await page.click('[data-email-suggest-item], [data-email-suggest-index="0"]');
  await page.waitForSelector('[data-email-suggest-menu]', { state: 'detached', timeout: 5000 }).catch(() => {});
  const toValue = await to.inputValue();
  check(/Dana Reed\s*<dana@example\.com>/i.test(toValue) || /dana@example\.com/i.test(toValue), `To filled (got: "${toValue}")`);

  step(4, 'Client and prior-mail sources appear for their queries');
  await to.fill('');
  await to.type('Acme', { delay: 40 });
  await page.waitForSelector('[data-email-suggest-menu]', { timeout: 8000 });
  const clientMenu = await page.textContent('[data-email-suggest-menu]');
  check(/Acme/i.test(clientMenu) && (/Client/i.test(clientMenu) || /hello@acme/i.test(clientMenu)), 'client suggestion appears');

  await page.keyboard.press('Escape');
  await to.fill('');
  await to.type('partner', { delay: 40 });
  await page.waitForSelector('[data-email-suggest-menu]', { timeout: 8000 });
  const priorMenu = await page.textContent('[data-email-suggest-menu]');
  check(/pat\.partner@example\.com/i.test(priorMenu) || /Previous email/i.test(priorMenu), 'prior-mail suggestion appears');

  step(5, 'Keyboard Enter selects the active suggestion');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  const afterEnter = await to.inputValue();
  check(/pat\.partner@example\.com/i.test(afterEnter), `Enter inserted prior address (got: "${afterEnter}")`);

  await page.screenshot({ path: 'tests/Browser/mail-suggest-final.png' });
} catch (e) {
  failures.push(`fatal: ${e.message}`);
  await page.screenshot({ path: 'tests/Browser/mail-suggest-error.png' }).catch(() => {});
}

log(`\n${failures.length === 0 ? 'PASS' : 'FAIL'} — ${failures.length} failure(s)`);
failures.forEach((f) => log(`  ✗ ${f}`));

await browser.close();
process.exit(failures.length === 0 ? 0 : 1);
