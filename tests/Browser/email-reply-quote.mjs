import { chromium } from 'playwright';

// A reply must answer the exact HTML of the original — not its snippet.
//
// The quote block used to be built from escaped plain text, which *looked*
// right in the composer (its CSS said pre-wrap) and arrived at the receiver
// as one flattened paragraph: no portal stylesheet travels with the mail, so
// every newline collapsed. This drives Reply on a message with a rich HTML
// body and inspects both the on-screen quote and the exact bodyHtml the send
// endpoint receives.
//
// Setup: the signature-import fixture (its first inbox message carries the
// rich body). See README.md.
const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8899';
const EMAIL = process.env.TMA_STAFF_EMAIL || 'e2e@example.com';
const log = (...a) => console.log(...a);
const failures = [];
const pageErrors = [];
const consoleErrors = [];

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

// The provider token is fake, so the send is answered here — after capturing
// the exact payload the client produced.
let sentPayload = null;
await context.route('**/portal/mail/send', (route) => {
  sentPayload = route.request().postDataJSON();
  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ sent: true }),
  });
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

try {
  step(1, 'Sign in and open the rich-bodied message');
  await signIn();
  await page.goto(`${BASE}/email`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-email-row]', { timeout: 15000 });

  const row = await page.$('[data-email-row]');
  const rowId = await row.getAttribute('data-email-row');
  await page.click(`[data-email-row="${rowId}"] .tma-dash__email-row-content`);
  await page.waitForSelector('[data-email-body-frame]', { timeout: 15000 });
  check(true, 'the reading pane rendered the HTML body');

  step(2, 'Reply quotes the exact HTML, not the snippet');
  await page.click('[data-email-inline-compose="reply"]');
  await page.waitForSelector('.tma-dash__email-inline-quote', { timeout: 8000 });

  const quote = await page.evaluate(
    () => document.querySelector('.tma-dash__email-inline-quote-body')?.innerHTML || ''
  );
  check(quote.includes('<b>quarterly figures</b>'), 'bold markup survived into the quote');
  check(quote.includes('<li>'), 'the list survived into the quote');
  check(/href="https:\/\/reports\.example\.com\/q3"/.test(quote), 'the link survived into the quote');
  check(!quote.includes('&lt;b&gt;'), 'the markup is real HTML, not escaped text');
  check(!quote.includes('Preview for'), 'the quote is the body, not the snippet');

  const lead = await page.evaluate(
    () => document.querySelector('.tma-dash__email-inline-quote-lead')?.textContent || ''
  );
  check(/^On .+, Dana Reed <dana@example\.com> wrote:$/.test(lead.trim()),
    `attribution line names the original sender (saw "${lead.trim()}")`);

  step(3, 'The sent payload carries the typed reply plus the exact quote');
  await page.click('[data-email-inline-compose-editor]');
  await page.keyboard.type('Thanks Dana — looks great.');
  await page.click('[data-email-inline-compose-send]');
  await page.waitForFunction(
    () => (document.querySelector('[data-email-toast-text]')?.textContent || '')
      .includes('Message sent'),
    { timeout: 15000 }
  );

  check(!!sentPayload, 'the send endpoint was called');
  const body = (sentPayload && sentPayload.bodyHtml) || '';
  check(body.includes('Thanks Dana — looks great.'), 'the typed reply is in the outgoing body');
  check(body.includes('<b>quarterly figures</b>'), 'the outgoing quote keeps the original bold markup');
  check(body.includes('<li>Revenue up <i>12%</i></li>'), 'the outgoing quote keeps the original list');
  check(/blockquote[^>]+style="[^"]*border-left/.test(body),
    'the quote carries inline styles the receiver can render');
  check(!body.includes('&lt;b&gt;'), 'nothing was double-escaped on the way out');
  check(sentPayload && sentPayload.mode === 'reply', 'the send is marked as a reply');

  step(4, 'No page errors during the whole flow');
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
