/* Verify the home dashboard's Messages tile renders the first 5 real chats. */
import { chromium } from 'playwright';

const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8899';
const SHOT = process.argv[2] || '/private/tmp/claude-501/-Users-vernonfrancis-Github-TMA-PORTAL/383321c6-dbe0-406e-b338-2b89420d4708/scratchpad/messages-tile.png';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } });

const IGNORE = /Origin not allowed|realtime disabled|Failed to load resource/;
const errors = [];
const note = (t) => { if (!IGNORE.test(t)) errors.push(t); };
page.on('pageerror', (e) => note(String(e)));
page.on('console', (m) => { if (m.type() === 'error') note(m.text()); });

await page.goto(`${BASE}/auth/login`, { waitUntil: 'networkidle' });
await page.click('text=Sign in with Email');
await page.waitForSelector('input[name="email"]', { state: 'visible', timeout: 8000 });
await page.fill('input[name="email"]', 'e2e@example.com');
await page.fill('input[name="password"]', 'password12345');
await Promise.all([
  page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}),
  page.click('button[type="submit"]:visible'),
]);
await page.waitForTimeout(500);
// A fresh session lands on the stay-signed-in prompt before the portal, and it
// redirects the JSON APIs too until it is answered.
if (page.url().includes('/auth/stay-signed-in')) {
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}),
    page.click('form:has(input[name="stay"][value="yes"]) button[type="submit"]'),
  ]);
  await page.waitForTimeout(400);
}
if (page.url().includes('/auth/login')) throw new Error('login failed');

// The tile starts as skeletons; wait for real rows or the empty state.
await page.waitForSelector('[data-tile-id="messages"]', { timeout: 20000 });
await page.waitForFunction(
  () => !document.querySelector('[data-tile-id="messages"]')?.hasAttribute('aria-busy'),
  { timeout: 20000 }
);
await page.waitForTimeout(800);

const tile = await page.$('[data-tile-id="messages"]');
const rows = await page.$$eval('.tma-portal-chat-row', (nodes) =>
  nodes.map((n) => ({
    name: n.querySelector('.tma-portal-chat-row__name')?.textContent?.trim(),
    time: n.querySelector('.tma-portal-chat-row__time')?.textContent?.trim(),
    preview: n.querySelector('.tma-portal-chat-row__preview')?.textContent?.trim(),
    unread: n.querySelector('.tma-portal-chat-row__unread')?.textContent?.trim() || null,
    online: !!n.querySelector('.tma-portal-chat-row__avatar.is-online'),
    avatar: n.querySelector('.tma-portal-chat-row__avatar img')?.getAttribute('src')?.slice(0, 40),
    id: n.getAttribute('data-home-chat'),
    // Confirm no row overflows its tile.
    overflow: n.scrollWidth > n.clientWidth + 1,
  }))
);
console.log('Tile head:', await page.$eval('[data-tile-id="messages"] .tma-portal-panel__title', (n) => n.textContent));
console.log('Tile meta:', await page.$$eval('[data-tile-id="messages"] .tma-portal-panel__meta', (n) => n.map((x) => x.textContent)));
console.log(JSON.stringify(rows, null, 2));

const api = await page.evaluate(async () => {
  const r = await fetch('/portal/messaging/conversations', { headers: { Accept: 'application/json' } });
  const j = await r.json();
  return (j.conversations || []).filter((c) => !c.archived).slice(0, 5).map((c) => ({ id: c.id, name: c.name }));
});
console.log('API first 5:', JSON.stringify(api));

if (tile) await tile.screenshot({ path: SHOT });

const fail = [];
if (rows.length !== Math.min(5, api.length)) fail.push(`expected ${Math.min(5, api.length)} rows, got ${rows.length}`);
rows.forEach((r, i) => {
  if (!r.name) fail.push(`row ${i} has no name`);
  if (!r.avatar) fail.push(`row ${i} has no avatar src`);
  if (r.overflow) fail.push(`row ${i} overflows its tile`);
  if (api[i] && r.name !== api[i].name) fail.push(`row ${i}: ${r.name} !== API ${api[i].name}`);
});

// The tile is a real board tile: Edit Dashboard lists it, and turning it off
// takes it off the board.
await page.click('[data-home-edit]');
await page.waitForSelector('[data-home-tile="messages"]', { timeout: 8000 });
const tileLabels = await page.$$eval('.tma-portal-tilerow__label', (n) => n.map((x) => x.textContent.trim()));
console.log('Edit Dashboard tiles:', JSON.stringify(tileLabels));
if (!tileLabels.includes('Messages')) fail.push('Edit Dashboard does not offer the Messages tile');
// The switch input sits under its own track/thumb spans, so a pointer click
// never lands on it — click the input itself.
await page.$eval('[data-home-tile="messages"]', (n) => n.click());
await page.click('[data-home-tiles-save]');
await page.waitForTimeout(1200);
if (await page.$('[data-tile-id="messages"]')) fail.push('turning the tile off left it on the board');

// Back on, so the run is repeatable.
await page.click('[data-home-edit]');
await page.waitForSelector('[data-home-tile="messages"]', { timeout: 8000 });
await page.$eval('[data-home-tile="messages"]', (n) => n.click());
await page.click('[data-home-tiles-save]');
await page.waitForSelector('[data-tile-id="messages"]', { timeout: 8000 });

// Clicking a row must open that conversation in the Messages view.
if (rows.length) {
  await page.waitForSelector(`[data-home-chat="${rows[0].id}"]`, { timeout: 15000 });
  await page.click(`[data-home-chat="${rows[0].id}"]`);
  await page.waitForTimeout(2500);
  const view = await page.$eval('.tma-dash__view[data-view="messages"]', (n) => !n.hasAttribute('hidden')).catch(() => false);
  if (!view) fail.push('clicking a row did not open the Messages view');
  const head = await page.$eval('.tma-dash__messages-chat-contact', (n) => n.textContent.trim()).catch(() => '');
  console.log('Opened chat header:', JSON.stringify(head));
  if (!head.includes(rows[0].name)) fail.push(`opened chat header "${head}" is not ${rows[0].name}`);
}

if (errors.length) fail.push(`console errors: ${errors.join(' | ')}`);
await browser.close();

if (fail.length) {
  console.error('\nFAIL:\n' + fail.map((f) => ' - ' + f).join('\n'));
  process.exit(1);
}
console.log('\nOK — Messages tile rendered the first 5 chats and opens them.');
