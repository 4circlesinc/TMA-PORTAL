import { chromium } from 'playwright';

// Drives the sidebar's Folder Shortcuts tab against a real server.
// See README.md for setup.
const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8899';
const log = (...a) => console.log(...a);
const errors = [];
const failures = [];

function step(n, msg) { log(`\n[${n}] ${msg}`); }
function check(ok, msg) {
  log(`    ${ok ? '✓' : '✗'} ${msg}`);
  if (!ok) failures.push(msg);
}

const browser = await chromium.launch();

async function signIn(page, email) {
  await page.goto(`${BASE}/auth/login`, { waitUntil: 'networkidle' });
  await page.click('text=Sign in with Email');
  await page.waitForSelector('input[name="email"]', { state: 'visible', timeout: 8000 });
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', 'password12345');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}),
    page.click('button[type="submit"]:visible'),
  ]);
  await page.waitForTimeout(500);
  if (page.url().includes('/auth/login')) throw new Error('login failed for ' + email);
}

const tab = (page, name) => page.click(`.tma-dash__sidebar .tma-dash__tab:has-text("${name}")`);

// Only "/" serves the portal shell — the file library is reached by clicking
// through the sidebar, exactly as a user does.
async function openLibrary(page, section = 'All Files') {
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  await tab(page, 'Main Menu');
  const folders = page.locator('.tma-dash__sidebar [data-expand="folders"]');
  if ((await folders.getAttribute('aria-expanded')) !== 'true') await folders.click();
  await page.click(`.tma-dash__sidebar .tma-dash__nav-item--nested:has-text("${section}")`);
  await page.waitForSelector('.tma-portal-table, .tma-portal-empty', { timeout: 10000 });
  await page.waitForTimeout(700);
}

// Right-click a folder row and pick an action from the context menu.
async function folderMenu(page, name, action) {
  await page.click(`.tma-portal-table td:has-text("${name}")`, { button: 'right' });
  await page.waitForSelector('.tma-portal-context-menu', { timeout: 5000 });
  const item = page.locator(`.tma-portal-context-menu__item:has-text("${action}")`);
  if (!(await item.count())) {
    const labels = await page.locator('.tma-portal-context-menu__item').allTextContents();
    throw new Error(`no "${action}" in menu; saw: ${JSON.stringify(labels)}`);
  }
  await item.first().click();
  await page.waitForTimeout(800);
}

const shortcutNames = (page) =>
  page.locator('[data-shortcuts] .tma-dash__shortcut .tma-dash__nav-item > span:not(.tma-dash__nav-caret)').allTextContents();

// Look a folder's uuid up through the same API the app uses.
const folderId = (page, name) => page.evaluate(async (n) => {
  const r = await window.TMAFilesNet.fetchJSON(window.TMAFilesNet.url('/?section=all&perPage=200'));
  return (r.folders.find((f) => f.name === n) || {}).id;
}, name);

const page = await browser.newPage();
page.on('console', (m) => {
  // The admin badge poll 403s for non-admins — noise, not this feature.
  if (m.type() === 'error' && !/403|404/.test(m.text())) errors.push('console: ' + m.text());
});
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

try {
  step(1, 'Logging in as the owner');
  await signIn(page, 'e2e@example.com');
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);

  // ── the two tabs ──────────────────────────────────────
  step(2, 'Sidebar tabs');
  const tabs = await page.locator('.tma-dash__sidebar .tma-dash__tab').allTextContents();
  log('    tabs:', JSON.stringify(tabs));
  check(tabs.length === 2, 'exactly two tabs');
  check(tabs[0].trim() === 'Main Menu', 'first tab is Main Menu');
  check(tabs[1].trim() === 'Folder Shortcuts', 'second tab is Folder Shortcuts');

  // Both labels must be legible, not clipped by the 225px sidebar.
  for (const t of await page.locator('.tma-dash__sidebar .tma-dash__tab').all()) {
    const clipped = await t.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
    check(!clipped, `tab "${(await t.textContent()).trim()}" is not clipped`);
  }

  const order = await page.locator('.tma-dash__sidebar [data-list="main"] .tma-dash__nav-item > span:not(.tma-dash__nav-caret)').allTextContents();
  log('    main menu:', JSON.stringify(order.map((s) => s.trim()).filter(Boolean).slice(0, 20)));
  check(await page.locator('.tma-dash__sidebar [data-nav="dash-dashboard"]').isVisible(), 'Main Menu shows Dashboard');
  check(await page.locator('.tma-dash__sidebar [data-nav="signatures"]').isVisible(), 'Main Menu shows Signatures');
  check(await page.locator('.tma-dash__sidebar [data-nav="account-settings"]').isVisible(), 'Main Menu shows Settings');
  check(!(await page.locator('.tma-dash__sidebar [data-shortcuts]').isVisible()), 'shortcuts list starts hidden');

  // ── nav icon colour: Dashboards accent, Pages black ───
  step(3, 'Nav icon colour');
  const primary = await page.evaluate(() => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--color-primary)';
    document.querySelector('.tma-dash').appendChild(probe);
    const c = getComputedStyle(probe).color;
    probe.remove();
    return c;
  });
  const readIcons = (loc) => loc.evaluateAll((els) => els.map((el) => {
    const cs = getComputedStyle(el);
    const row = el.closest('[data-nav],[data-expand]');
    const art = (cs.maskImage || cs.webkitMaskImage || '');
    return {
      nav: row?.getAttribute('data-nav') || row?.getAttribute('data-expand'),
      active: !!row?.classList.contains('tma-dash__nav-item--active'),
      bg: cs.backgroundColor,
      art: art.replace(/.*\/([^/"]+)\.svg.*/, '$1'),
      url: art.replace(/^url\("([^"]*)"\).*/, '$1'),
      box: cs.width + '×' + cs.height,
    };
  }));

  // Two "main" sections, in order: the Dashboards group, then the Pages group.
  const sections = page.locator('.tma-dash__sidebar [data-list="main"]');
  check(await sections.count() === 2, 'the main menu has its two groups');
  const dash = await readIcons(sections.nth(0).locator('.tma-dash__nav-icon'));
  const pages = await readIcons(sections.nth(1).locator('.tma-dash__nav-icon'));
  log('    --color-primary resolves to', primary);
  log('    Dashboards:', JSON.stringify(dash.map((i) => `${i.nav}:${i.art}`)));
  log('    Pages:     ', JSON.stringify(pages.map((i) => `${i.nav}:${i.art}`)));

  check(dash.length === 8, `all 8 Dashboards icons found (${dash.length})`);
  check(dash.every((i) => i.bg === primary), 'every Dashboards icon paints in the system primary colour');
  check(new Set(dash.map((i) => i.art)).size === 8, 'each Dashboards item keeps its own distinct artwork');

  check(pages.length === 7, `all 7 Pages icons found (${pages.length})`);
  check(pages.every((i) => i.bg === 'rgb(0, 0, 0)'), 'Pages icons stay black');
  check(new Set(pages.map((i) => i.art)).size === 7, 'each Pages item keeps its own distinct artwork');

  const all = [...dash, ...pages];
  check(new Set(all.map((i) => i.box)).size === 1, `every icon keeps one box size (${all[0].box})`);
  // A mask that 404s still leaves a correctly sized, correctly coloured box —
  // only the resolved URL shows the art is really reachable from this page.
  check(all.every((i) => /\/images\/icons\/phosphor\/[A-Za-z]+\.svg$/.test(i.url)),
    'every icon resolves its art under /images/icons/phosphor');

  // Active item wears the filled weight; nothing else does.
  step(3.5, 'Filled icon on the active item');
  const active = all.filter((i) => i.active);
  log('    active:', JSON.stringify(active.map((i) => `${i.nav}:${i.art}`)));
  check(active.length === 1 && active[0].nav === 'dash-dashboard', 'Dashboard is the active item');
  check(active[0].art === 'HouseFill', 'the active item uses the filled glyph');
  check(all.filter((i) => !i.active).every((i) => !/Fill$/.test(i.art)), 'inactive items stay outlined');

  // Follow the active state onto a Pages item — filled, and still black.
  await page.click('.tma-dash__sidebar [data-nav="signatures"]');
  await page.waitForTimeout(900);
  const after3 = [...await readIcons(sections.nth(0).locator('.tma-dash__nav-icon')),
    ...await readIcons(sections.nth(1).locator('.tma-dash__nav-icon'))];
  const sig = after3.find((i) => i.nav === 'signatures');
  const home = after3.find((i) => i.nav === 'dash-dashboard');
  log('    Signatures now:', JSON.stringify(sig));
  check(sig.art === 'SignatureFill', 'a Pages item fills when it becomes active');
  check(sig.bg === 'rgb(0, 0, 0)', 'the filled Pages icon is still black');
  check(home.art === 'House', 'the previously active item returns to outline');

  // ── add a folder from the File Library ────────────────
  step(4, 'Add to Folder Shortcuts from the File Library');
  await openLibrary(page);
  await folderMenu(page, 'Contracts', 'Add to Folder Shortcuts');

  await tab(page, 'Folder Shortcuts');
  await page.waitForTimeout(600);
  check(await page.locator('.tma-dash__sidebar [data-shortcuts]').isVisible(), 'the shortcuts list shows on its tab');
  check(!(await page.locator('.tma-dash__sidebar [data-nav="dash-dashboard"]').isVisible()), 'the main menu hides on the shortcuts tab');
  let names = await shortcutNames(page);
  log('    shortcuts:', JSON.stringify(names));
  check(names.includes('Contracts'), 'the pinned folder is listed');
  check(await page.locator('.tma-dash__sidebar [data-shortcut] img[src*="Folder"]').first().isVisible(), 'the shortcut shows a folder icon');

  // ── no duplicates ─────────────────────────────────────
  step(5, 'Pinning the same folder twice');
  await openLibrary(page);
  await page.click('.tma-portal-table td:has-text("Contracts")', { button: 'right' });
  await page.waitForSelector('.tma-portal-context-menu');
  const labels = await page.locator('.tma-portal-context-menu__item').allTextContents();
  check(labels.some((l) => l.includes('Remove from Folder Shortcuts')), 'the menu offers Remove once pinned');
  await page.keyboard.press('Escape');

  // Force the duplicate the UI won't offer, straight at the API.
  const contractsId = await folderId(page, 'Contracts');
  const dupe = await page.evaluate(async (id) => await window.TMAFilesNet.fetchJSON(
    window.TMAFilesNet.url('/shortcuts'), { method: 'POST', json: { folder: id } },
  ).catch((e) => ({ error: e.message })), contractsId);
  check(!dupe.error && dupe.shortcuts.filter((s) => s.name === 'Contracts').length === 1,
    'a repeat add leaves exactly one shortcut');

  // ── nested + shared folders ───────────────────────────
  step(6, 'Nested and shared folders');
  await folderMenu(page, 'Contracts', 'Open');
  await folderMenu(page, 'Signed 2026', 'Add to Folder Shortcuts');
  await tab(page, 'Folder Shortcuts');
  await page.waitForTimeout(500);
  names = await shortcutNames(page);
  check(names.includes('Signed 2026'), 'a nested folder can be pinned');
  const title = await page.locator('.tma-dash__sidebar [data-shortcut] .tma-dash__nav-item[title*="Signed 2026"]').getAttribute('title');
  log('    nested tooltip:', JSON.stringify(title));
  check(title === 'Contracts / Signed 2026', 'a nested folder names its parent in the tooltip');

  // "Shared Docs" belongs to the other user and is shared with this one.
  await openLibrary(page, 'Shared with me');
  await folderMenu(page, 'Shared Docs', 'Add to Folder Shortcuts');
  await tab(page, 'Folder Shortcuts');
  await page.waitForTimeout(500);
  names = await shortcutNames(page);
  log('    shortcuts:', JSON.stringify(names));
  check(names.includes('Shared Docs'), 'a folder shared with the user can be pinned');

  // ── opening a shortcut ────────────────────────────────
  step(7, 'Clicking a shortcut opens that folder');
  await page.click('.tma-dash__sidebar [data-shortcut] .tma-dash__nav-item:has-text("Contracts")');
  await page.waitForTimeout(1400);
  const rows = await page.locator('.tma-portal-table tbody td').allTextContents();
  log('    rows:', JSON.stringify(rows.map((r) => r.trim()).filter(Boolean).slice(0, 5)));
  check(rows.some((r) => r.includes('Signed 2026')), 'it lands inside Contracts, listing its contents');

  // ── reorder ───────────────────────────────────────────
  step(8, 'Reordering by drag');
  await tab(page, 'Folder Shortcuts');
  await page.waitForTimeout(400);
  const before = await shortcutNames(page);
  log('    before:', JSON.stringify(before));
  await page.locator('.tma-dash__sidebar [data-shortcut]').first().dragTo(page.locator('.tma-dash__sidebar [data-shortcut]').last());
  await page.waitForTimeout(1000);
  const after = await shortcutNames(page);
  log('    after: ', JSON.stringify(after));
  check(JSON.stringify(before) !== JSON.stringify(after), 'the order changed');
  check([...before].sort().join() === [...after].sort().join(), 'reordering kept every shortcut');

  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  await tab(page, 'Folder Shortcuts');
  await page.waitForTimeout(800);
  const persisted = await shortcutNames(page);
  log('    reloaded:', JSON.stringify(persisted));
  check(JSON.stringify(persisted) === JSON.stringify(after), 'the new order survives a reload');

  // ── per-user isolation ────────────────────────────────
  step(9, 'A second user has their own list');
  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await signIn(otherPage, 'other@example.com');
  await otherPage.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await otherPage.waitForTimeout(700);
  await tab(otherPage, 'Folder Shortcuts');
  await otherPage.waitForTimeout(900);
  const otherNames = await shortcutNames(otherPage);
  const note = await otherPage.textContent('.tma-dash__shortcut-note').catch(() => null);
  log('    other user sees:', JSON.stringify(otherNames), '| note:', JSON.stringify(note));
  check(otherNames.length === 0, 'the other user sees none of the first user’s shortcuts');
  check(!!note, 'the other user gets the empty state');

  // A folder they cannot see must not be pinnable even via the API.
  const forbidden = await otherPage.evaluate(async (id) => {
    try {
      await window.TMAFilesNet.fetchJSON(window.TMAFilesNet.url('/shortcuts'), {
        method: 'POST', json: { folder: id },
      });
      return 'allowed';
    } catch (e) { return String(e.status); }
  }, contractsId);
  log('    pinning a folder they can’t view:', forbidden);
  check(forbidden === '403', 'the server refuses a folder the user may not view');
  await other.close();

  // ── removal ───────────────────────────────────────────
  step(10, 'Removing a shortcut');
  await tab(page, 'Folder Shortcuts');
  await page.waitForTimeout(400);
  const target = page.locator('.tma-dash__sidebar [data-shortcut]:has-text("Signed 2026")');
  await target.hover();
  await target.locator('.tma-dash__shortcut-remove').click();
  await page.waitForTimeout(1000);
  names = await shortcutNames(page);
  log('    shortcuts:', JSON.stringify(names));
  check(!names.includes('Signed 2026'), 'the removed shortcut is gone');

  // ── deleting the folder drops the shortcut ────────────
  step(11, 'Deleting a pinned folder');
  await openLibrary(page);
  await folderMenu(page, 'Contracts', 'Delete');
  await page.click('button:has-text("Move to bin"):visible');
  await page.waitForTimeout(1800);
  await tab(page, 'Folder Shortcuts');
  await page.waitForTimeout(900);
  names = await shortcutNames(page);
  log('    shortcuts:', JSON.stringify(names));
  check(!names.includes('Contracts'), 'a deleted folder leaves the sidebar on its own');
  check(names.includes('Shared Docs'), 'the surviving shortcuts stay');

  // ── report ────────────────────────────────────────────
  log('\n──────── result ────────');
  if (errors.length) log('page errors:\n  ' + errors.join('\n  '));
  if (failures.length) {
    log(`FAILED (${failures.length}):\n  ` + failures.join('\n  '));
    process.exitCode = 1;
  } else {
    log('All checks passed.');
  }
} catch (e) {
  log('\nERROR: ' + e.message);
  if (errors.length) log('page errors:\n  ' + errors.join('\n  '));
  await page.screenshot({ path: '/tmp/folder-shortcuts-failure.png', fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
