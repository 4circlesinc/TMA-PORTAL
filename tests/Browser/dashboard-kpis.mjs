/* Verify the portal home KPI row renders server-measured numbers. */
import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:8899';
const SHOT = process.argv[2] || '/private/tmp/claude-501/-Users-vernonfrancis-Github-TMA-PORTAL/15af6aa4-859b-419e-b65e-3eafa92eb0fe/scratchpad/kpi.png';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });

// Reverb rejects the throwaway dev origin, and messaging says so loudly on
// every page. That is the harness, not the dashboard — everything else counts.
const IGNORE = /Origin not allowed|realtime disabled/;

const errors = [];
const note = (text) => { if (!IGNORE.test(text)) errors.push(text); };
page.on('pageerror', (e) => note(String(e)));
page.on('console', (m) => { if (m.type() === 'error') note(m.text()); });

// The login screen offers providers first; the email form is behind a button.
await page.goto(`${BASE}/auth/login`, { waitUntil: 'networkidle' });
await page.click('text=Sign in with Email');
await page.waitForSelector('input[name="email"]', { state: 'visible', timeout: 8000 });
await page.fill('input[name="email"]', 'e2e@example.com');
await page.fill('input[name="password"]', 'password12345');
await Promise.all([
  page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}),
  page.click('button[type="submit"]:visible'),
]);
if (page.url().includes('/auth/login')) throw new Error('login failed');

// The KPI row starts as skeletons; wait for the measured cards.
await page.waitForSelector('.tma-dash__card-value', { timeout: 30000 });
await page.waitForTimeout(1500);

const cards = await page.$$eval('.tma-dash__card', (nodes) =>
  nodes.map((n) => ({
    label: n.querySelector('.tma-dash__card-label')?.textContent?.trim(),
    value: n.querySelector('.tma-dash__card-value')?.textContent?.trim(),
    delta: n.querySelector('.tma-dash__card-delta-text')?.textContent?.trim(),
    hint: n.getAttribute('title'),
  }))
);

console.log(JSON.stringify(cards, null, 2));

const api = await page.evaluate(async () => {
  const r = await fetch('/portal/dashboard/metrics', { headers: { Accept: 'application/json' } });
  return r.json();
});
console.log('API scope:', api.scope, '| window:', api.windowDays, 'days');

const row = await page.$('.tma-dash__cards');
if (row) await row.screenshot({ path: SHOT });

// Assertions: every card must carry a real measurement, no placeholders left.
const fail = [];
if (cards.length !== 4) fail.push(`expected 4 cards, got ${cards.length}`);
const labels = cards.map((c) => c.label);
for (const want of ['Avg. Response to Clients', 'Files Shared', 'Clients Awaiting Reply', 'Awaiting Signature']) {
  if (!labels.includes(want)) fail.push(`missing card: ${want}`);
}
for (const c of cards) {
  if (!c.value || c.value === '—') fail.push(`${c.label} has no measured value (${c.value})`);
  if (!c.hint) fail.push(`${c.label} has no hint`);
}
if (errors.length) fail.push(`console errors: ${errors.join(' | ')}`);

await browser.close();

if (fail.length) {
  console.error('\nFAIL:\n' + fail.map((f) => ' - ' + f).join('\n'));
  process.exit(1);
}
console.log('\nOK — all four cards rendered measured values.');
