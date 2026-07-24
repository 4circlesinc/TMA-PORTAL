import { chromium } from 'playwright';

// Label management end to end: the tag button on inbox rows, the "Label as"
// picker, creating / renaming / recolouring / deleting labels through the
// sidebar editor, the org-member avatar on mail rows, and the live folder
// counts (sidebar badge + dashboard nav badge) fed by the poll response.
//
// Needs the mail-labels seed (see the setup block in the repo history or
// README): a google mailbox with a provider label 'Clients', a portal-only
// label 'Personal', three inbox messages (Dana Reed / Ana Ruiz / Sam Lee),
// and a portal user dana@example.com with an avatar_url.
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

// The five-second poll hits /sync?fast=1, which cannot reach a real provider
// here. Stub it with fresh folder counts so the "counts update live" wiring
// is exercised end to end: response → state → sidebar badge → nav badge.
let syncCounts = null;
await context.route('**/portal/mail/sync?fast=1', (route) => {
  if (!syncCounts) return route.continue();
  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ synced: 0, fast: true, folders: syncCounts }),
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
  if (page.url().includes('/auth/login')) throw new Error('login failed');
}

function sidebarLabels() {
  return page.$$eval('[data-email-sidebar-label]', (els) => els.map((el) => el.textContent.trim()));
}

try {
  step(1, 'Sign in and open the mailbox');
  await signIn();
  await page.goto(`${BASE}/email`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-email-row]', { timeout: 15000 });

  step(2, 'The sidebar lists both labels, with a server-side count');
  const names = await sidebarLabels();
  check(names.some((n) => n.includes('Clients')), `Clients is listed (saw: ${names.join(' | ')})`);
  check(names.some((n) => n.includes('Personal')), 'Personal is listed');
  const clientsText = names.filter((n) => n.includes('Clients'))[0] || '';
  check(/1/.test(clientsText), `Clients carries its whole-mailbox count (saw "${clientsText}")`);

  step(3, 'An org member sender shows their portal avatar');
  const avatarSrc = await page.$eval(
    '[data-email-row] .tma-dash__email-row-avatar img',
    (img) => img.getAttribute('src')
  ).catch(() => null);
  check(
    !!avatarSrc && avatarSrc.includes('/images/avatars/Avatar3d01.png'),
    `Dana's row uses her portal avatar (saw "${avatarSrc}")`
  );

  step(4, 'Every inbox row has a label (tag) button that opens the picker');
  const rows = await page.$$('[data-email-row]');
  const secondRowId = await rows[1].getAttribute('data-email-row');
  const tagButtons = await page.$$('[data-email-label]');
  check(tagButtons.length >= rows.length, `each row renders a tag button (${tagButtons.length} for ${rows.length} rows)`);

  await rows[1].hover();
  await page.click(`[data-email-label="${secondRowId}"]`);
  await page.waitForTimeout(200);
  const menuVisible = await page.$eval('[data-email-label-menu]', (el) => !el.hidden);
  check(menuVisible, 'clicking the tag button opens the Label as menu');

  step(5, 'Applying the portal-only label sticks — row chip, server row, sidebar count');
  const personalOption = await page.$$eval('[data-email-label-option]', (els) => {
    const hit = els.filter((el) => el.textContent.includes('Personal'))[0];
    return hit ? hit.getAttribute('data-email-label-option') : null;
  });
  check(!!personalOption, 'the picker offers Personal');
  await page.click(`[data-email-label-option="${personalOption}"]`);
  await page.waitForTimeout(600);

  const chipText = await page.textContent(`[data-email-row="${secondRowId}"]`);
  check(chipText.includes('Personal'), 'the row now shows the Personal chip');

  const serverRow = await page.evaluate(async (id) => {
    const res = await fetch('/portal/mail/messages?folder=inbox', { headers: { Accept: 'application/json' } });
    const data = await res.json();
    return (data.messages || []).filter((m) => m.id === id)[0] || null;
  }, secondRowId);
  check(
    !!serverRow && (serverRow.labels || []).indexOf(personalOption) !== -1,
    'the server row carries the label (no provider round trip needed)'
  );

  await page.keyboard.press('Escape');

  step(6, 'The sidebar + creates a label through the editor');
  await page.click('[data-email-label-create]');
  await page.waitForSelector('[data-email-label-editor]:not([hidden])', { timeout: 4000 });
  await page.screenshot({ path: 'tests/Browser/mail-labels.png' });
  await page.fill('[data-email-label-editor-name]', 'Urgent');
  await page.click('[data-email-label-editor-tone="red"]');
  await page.click('[data-email-label-editor-save]');
  // Creation asks the provider first and falls back to portal-only when that
  // fails (it must here — the token is fake), so give it a moment.
  await page.waitForFunction(
    () => Array.prototype.some.call(
      document.querySelectorAll('[data-email-sidebar-label]'),
      (el) => el.textContent.includes('Urgent')
    ),
    { timeout: 15000 }
  );
  check(true, 'Urgent appears in the sidebar');
  const editorClosed = await page.$eval('[data-email-label-editor]', (el) => el.hidden);
  check(editorClosed, 'the editor closed after saving');

  step(7, 'A label can be renamed and recoloured');
  const personalRow = await page.$$eval('.tma-dash__email-label-row', (els) => {
    const hit = els.filter((el) => el.textContent.includes('Personal'))[0];
    const edit = hit && hit.querySelector('[data-email-label-edit]');
    return edit ? edit.getAttribute('data-email-label-edit') : null;
  });
  check(!!personalRow, 'the sidebar row exposes an edit control');
  await page.hover('.tma-dash__email-label-row:has-text("Personal")');
  await page.click(`[data-email-label-edit="${personalRow}"]`);
  await page.waitForSelector('[data-email-label-editor]:not([hidden])', { timeout: 4000 });
  const prefill = await page.$eval('[data-email-label-editor-name]', (el) => el.value);
  check(prefill === 'Personal', `the editor opens pre-filled (saw "${prefill}")`);
  await page.fill('[data-email-label-editor-name]', 'Private');
  await page.click('[data-email-label-editor-tone="purple"]');
  await page.click('[data-email-label-editor-save]');
  await page.waitForFunction(
    () => Array.prototype.some.call(
      document.querySelectorAll('[data-email-sidebar-label]'),
      (el) => el.textContent.includes('Private')
    ),
    { timeout: 10000 }
  );
  const renamed = await sidebarLabels();
  check(!renamed.some((n) => n.includes('Personal')), 'the old name is gone');
  const chipAfterRename = await page.textContent(`[data-email-row="${secondRowId}"]`);
  check(chipAfterRename.includes('Private'), 'the row chip follows the rename');

  step(8, 'Deleting a label needs a second, armed click — then removes it everywhere');
  const urgentEdit = await page.$$eval('.tma-dash__email-label-row', (els) => {
    const hit = els.filter((el) => el.textContent.includes('Urgent'))[0];
    const edit = hit && hit.querySelector('[data-email-label-edit]');
    return edit ? edit.getAttribute('data-email-label-edit') : null;
  });
  await page.hover('.tma-dash__email-label-row:has-text("Urgent")');
  await page.click(`[data-email-label-edit="${urgentEdit}"]`);
  await page.waitForSelector('[data-email-label-editor]:not([hidden])', { timeout: 4000 });
  await page.click('[data-email-label-editor-delete]');
  const armed = await page.textContent('[data-email-label-editor-delete]');
  check(/really/i.test(armed), `the first click arms rather than deletes ("${armed.trim()}")`);
  await page.click('[data-email-label-editor-delete]');
  await page.waitForFunction(
    () => !Array.prototype.some.call(
      document.querySelectorAll('[data-email-sidebar-label]'),
      (el) => el.textContent.includes('Urgent')
    ),
    { timeout: 10000 }
  );
  check(true, 'Urgent is gone from the sidebar');

  step(9, 'Folder counts follow the live poll — sidebar badge and dashboard nav badge');
  const badgeBefore = (await page.textContent('[data-email-folder="inbox"]')).trim();
  check(/2/.test(badgeBefore), `Inbox badges 2 unread to start (saw "${badgeBefore}")`);

  syncCounts = {
    inbox: { total: 8, unread: 7 },
    sent: { total: 1, unread: 0 },
  };
  await page.waitForFunction(
    () => /7/.test((document.querySelector('[data-email-folder="inbox"]') || {}).textContent || ''),
    { timeout: 20000 }
  );
  check(true, 'the sidebar inbox badge updated from the poll without a reload');

  const navBadge = await page.textContent('.tma-dash__nav-item[data-nav="email"] .tma-dash__nav-count').catch(() => '');
  check(/7/.test(navBadge || ''), `the dashboard Email nav badge followed (saw "${navBadge}")`);

  await page.screenshot({ path: 'tests/Browser/mail-labels-final.png' });
} catch (e) {
  failures.push(`fatal: ${e.message}`);
  await page.screenshot({ path: 'tests/Browser/mail-labels-error.png' }).catch(() => {});
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
