/* Verify the head's Today / This week / This month / This year picker drives the KPI row. */
import { chromium } from 'playwright';

const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8899';
const SHOTS = process.env.TMA_SHOTS || '/tmp';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });

// Reverb rejects the throwaway dev origin, and the KPI seed's PDFs have no
// bytes behind them so their thumbnails 422. Both are the harness, not the row.
const IGNORE = /Origin not allowed|realtime disabled|Failed to load resource/;
const errors = [];
const note = (t) => { if (!IGNORE.test(t)) errors.push(t); };
page.on('pageerror', (e) => note(String(e)));
page.on('console', (m) => { if (m.type() === 'error') note(m.text()); });

const metricsRequests = [];
const failedResponses = [];
page.on('response', (r) => { if (r.status() >= 400) failedResponses.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`); });
page.on('request', (r) => { if (r.url().includes('/portal/dashboard/metrics')) metricsRequests.push(new URL(r.url()).search); });

await page.goto(`${BASE}/auth/login`, { waitUntil: 'domcontentloaded' });
await page.click('text=Sign in with Email');
await page.waitForSelector('input[name="email"]', { state: 'visible', timeout: 8000 });
await page.fill('input[name="email"]', 'e2e@example.com');
await page.fill('input[name="password"]', 'password12345');
await page.click('button[type="submit"]:visible');
await page.waitForURL(/stay-signed-in|\/$/, { timeout: 15000 });
if (page.url().includes('stay-signed-in')) {
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}),
    page.click('button:has-text("Yes")'),
  ]);
}
await page.waitForSelector('.tma-dash__card-value', { timeout: 30000 });
await page.waitForTimeout(800);

async function readCards() {
  return page.$$eval('.tma-dash__card', (nodes) => nodes.map((n) => ({
    label: n.querySelector('.tma-dash__card-label')?.textContent?.trim(),
    value: n.querySelector('.tma-dash__card-value')?.textContent?.trim(),
    delta: n.querySelector('.tma-dash__card-delta-text')?.textContent?.trim(),
    hint: n.getAttribute('title'),
  })));
}
async function pick(label) {
  metricsRequests.length = 0;
  await page.click('[data-today-dropdown] [data-head-dropdown-toggle]');
  await page.waitForSelector('[data-today-menu]:not([hidden])');
  await page.click(`[data-today-menu] [data-today="${label}"]`);
  // Skeletons first, then the measured cards for the new period.
  await page.waitForSelector('.tma-dash__card-value', { timeout: 15000 });
  await page.waitForTimeout(600);
  return {
    label: (await page.textContent('[data-today-label]')).trim(),
    request: metricsRequests[0],
    cards: await readCards(),
    // What the server says for this period, so the row can be checked
    // against it on any date rather than against counts that depend on
    // which weekday and day of the month the seed ran.
    api: await page.evaluate((q) => fetch('/portal/dashboard/metrics' + q, { headers: { Accept: 'application/json' } }).then((r) => r.json()), metricsRequests[0]),
  };
}

const results = {};
results.boot = { label: (await page.textContent('[data-today-label]')).trim(), request: metricsRequests[0], cards: await readCards() };
for (const label of ['This week', 'This month', 'This year', 'Today']) {
  results[label] = await pick(label);
  await page.screenshot({ path: `${SHOTS}/period-${label.replace(/\s+/g, '-').toLowerCase()}.png`, clip: { x: 0, y: 0, width: 1500, height: 520 } });
}

// The choice survives a reload and is asked for straight away.
metricsRequests.length = 0;
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('.tma-dash__card-value', { timeout: 30000 });
await page.waitForTimeout(800);
results.afterReload = { label: (await page.textContent('[data-today-label]')).trim(), requests: metricsRequests.slice(), cards: await readCards() };

console.log(JSON.stringify(results, null, 2));

const fail = [];
const cip = (r) => r.cards.find((c) => c.label === 'New CIP Applications');
if (results['This week'].request !== '?period=week') fail.push(`week request: ${results['This week'].request}`);
if (results['This month'].request !== '?period=month') fail.push(`month request: ${results['This month'].request}`);
if (results['This year'].request !== '?period=year') fail.push(`year request: ${results['This year'].request}`);
if (results['Today'].request !== '?period=today') fail.push(`today request: ${results['Today'].request}`);
const response = (r) => r.cards.find((c) => c.label === 'Avg. Response to Clients');
for (const label of ['Today', 'This week', 'This month', 'This year']) {
  const r = results[label];
  if (!r.api || !r.api.cards) { fail.push(`${label}: no API answer`); continue; }
  if (cip(r).value !== r.api.cards.cipNew.value) fail.push(`${label} cip: row says ${cip(r).value}, API says ${r.api.cards.cipNew.value}`);
  if (response(r).value !== r.api.cards.clientResponse.value) fail.push(`${label} response: row says ${response(r).value}, API says ${r.api.cards.clientResponse.value}`);
  if (cip(r).hint !== r.api.cards.cipNew.hint) fail.push(`${label} hint: ${cip(r).hint}`);
}
// The seed makes the four periods disagree; identical rows would mean the selection never reached the server.
if (new Set(['Today', 'This week', 'This month', 'This year'].map((l) => cip(results[l]).value)).size < 3) fail.push('the periods all show the same CIP count');
if (!/this week\.$/.test(cip(results['This week']).hint || '')) fail.push(`week hint: ${cip(results['This week']).hint}`);
if (results.afterReload.label !== 'Today') fail.push(`label after reload: ${results.afterReload.label}`);
// The Overview page's own metrics call (overview.js) carries no period; the home row's must.
const periodRequests = results.afterReload.requests.filter((q) => q.includes('period='));
if (!periodRequests.length || !periodRequests.every((q) => q === '?period=today')) fail.push(`reload requests: ${results.afterReload.requests.join(',')}`);
const unexplained = [...new Set(failedResponses)].filter((r) => !/^422 GET \/portal\/files\/files\/[^/]+\/preview$/.test(r));
if (unexplained.length) fail.push(`failed responses: ${unexplained.join(' | ')}`);
if (errors.length) fail.push(`console errors: ${errors.join(' | ')}`);

await browser.close();
if (fail.length) { console.error('\nFAIL:\n' + fail.map((f) => ' - ' + f).join('\n')); process.exit(1); }
console.log('\nOK — the picker drives the KPI row and survives a reload.');
