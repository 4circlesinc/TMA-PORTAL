/*
 * Dark-mode audit, part 3: overview tabs, filter popovers, dialogs, detail
 * screens. Same probe. AUDIT_OUT=<dir> node tests/Browser/dark-audit-3.mjs
 */
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8907';
const OUT = process.env.AUDIT_OUT || 'tests/Browser';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
const IGNORE = /Origin not allowed|realtime disabled|Reverb|websocket|WebSocket|broadcasting\/auth/i;
page.on('pageerror', (e) => { if (!IGNORE.test(String(e))) console.log('  pageerror:', String(e).slice(0, 200)); });
await page.addInitScript(() => { try { localStorage.setItem('tma.themeMode', 'dark'); } catch (e) {} });

const PROBE_SRC = fs.readFileSync('tests/Browser/dark-audit.mjs', 'utf8');
const PROBE = new Function('return (' + PROBE_SRC.split('const PROBE = ')[1].split(';\n\nconst report')[0] + ')')();

await page.goto(`${BASE}/auth/login`, { waitUntil: 'networkidle' });
await page.click('text=Sign in with Email');
await page.waitForSelector('input[name="email"]', { state: 'visible' });
await page.fill('input[name="email"]', 'e2e@example.com');
await page.fill('input[name="password"]', 'password12345');
await Promise.all([
  page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}),
  page.click('button[type="submit"]:visible'),
]);
if (page.url().includes('/auth/stay-signed-in')) {
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}),
    page.click('form:has(input[name="stay"][value="yes"]) button[type="submit"]'),
  ]);
}
console.log('logged in');
await page.waitForTimeout(1500);

const report = {};
const shot = async (name) => {
  await page.waitForTimeout(1000);
  const res = await page.evaluate(PROBE);
  report[name] = res;
  await page.screenshot({ path: `${OUT}/dark3-${name}.png` });
  console.log(`${name}: issues=${res.issues.length}`);
};
const tryStep = async (name, fn) => {
  try { await fn(); await shot(name); } catch (e) { report[name] = { error: String(e).slice(0, 200) }; console.log(`${name}: ERROR ${String(e).slice(0, 140)}`); }
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(300);
};

// overview tabs
for (const tab of ['Employees', 'Users', 'Files', 'Notifications', 'Activity', 'Recycle Bin']) {
  await tryStep('overview-' + tab.replace(/\s/g, ''), async () => {
    if (!page.url().includes('/overview')) { await page.goto(`${BASE}/overview`, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(1500); }
    await page.click(`[data-overview-tab="${tab}"]`);
    await page.waitForTimeout(1200);
  });
}

// citizenship applications: create dropdown + filter popover
await tryStep('cip-create-menu', async () => {
  await page.goto(`${BASE}/citizenship-applications`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  await page.click('button:has-text("Create New Application")');
});
await tryStep('cip-filter', async () => {
  const f = page.locator('button:has-text("Filter")').first();
  await f.click({ timeout: 8000 });
});

// users: row click -> user detail
await tryStep('user-detail', async () => {
  await page.goto(`${BASE}/users`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1800);
  await page.click('.tma-dash__users tbody tr >> nth=0');
  await page.waitForTimeout(1200);
});

// templates: open first row (system email template editor)
await tryStep('template-editor', async () => {
  await page.goto(`${BASE}/templates/email`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  await page.click('.tma-portal-table tbody tr >> nth=0');
  await page.waitForTimeout(1500);
});

// signatures: create request dialog
await tryStep('signature-request', async () => {
  await page.goto(`${BASE}/signatures`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1800);
  await page.click('button:has-text("Create signature request")');
  await page.waitForTimeout(1200);
});

// files: share dialog via context menu
await tryStep('files-share-dialog', async () => {
  await page.goto(`${BASE}/folders/all`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.tma-portal-files-table tbody tr', { timeout: 15000 });
  await page.click('.tma-portal-files-table tbody tr', { button: 'right' });
  await page.waitForTimeout(400);
  await page.click('.tma-portal-context-menu >> text=Share');
  await page.waitForTimeout(1000);
});

// settings subpages
for (const sp of ['notifications', 'privacy', 'time-language', 'account-security']) {
  await tryStep('settings-' + sp, async () => {
    await page.goto(`${BASE}/account-settings?settings-page=${sp}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1800);
  });
}

// storage usage + recycle bin (file pages with distinct chrome)
await tryStep('people-person-panel', async () => {
  await page.goto(`${BASE}/people/employees`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1800);
  await page.click('.tma-portal-table tbody tr >> nth=0');
  await page.waitForTimeout(1000);
});

fs.writeFileSync(`${OUT}/dark-audit-3.json`, JSON.stringify(report, null, 2));
console.log('wrote dark-audit-3.json');
await browser.close();
