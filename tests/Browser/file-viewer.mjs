import { chromium } from 'playwright';

/**
 * Phase 1 — the collaboration viewer.
 *
 * PHPUnit covers the panel endpoints (tests/Feature/FileViewerPanelTest.php).
 * What only a browser can show is the thing the spec actually asks for: three
 * regions, a permission-gated toolbar, panels that load real data lazily, and
 * — §29 — a viewer whose state survives interaction instead of resetting.
 *
 * Needs the seeded harness (see the File Library browser-testing notes):
 * an administrator e2e@example.com and a real PDF in a "Contracts" folder.
 */
const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8899';
const failures = [];
const errors = [];
const log = (...a) => console.log(...a);
function step(n, m) { log(`\n[${n}] ${m}`); }
function check(ok, m) { log(`    ${ok ? '✓' : '✗'} ${m}`); if (!ok) failures.push(m); }

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/403|404/.test(m.text())) errors.push('console: ' + m.text()); });

async function signIn(email) {
  await page.goto(`${BASE}/auth/login`, { waitUntil: 'domcontentloaded' });
  await page.click('text=Sign in with Email');
  await page.waitForSelector('input[name="email"]', { state: 'visible', timeout: 8000 });
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', 'password12345');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}),
    page.click('button[type="submit"]:visible'),
  ]);
  await page.waitForTimeout(600);
  if (page.url().includes('/auth/stay-signed-in')) {
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}),
      page.click('text=Yes, stay signed in'),
    ]);
    await page.waitForTimeout(600);
  }
  if (page.url().includes('/auth/login')) throw new Error('login failed for ' + email);
}

async function openLibrary() {
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-expand="folders"]', { timeout: 15000 });
  await page.waitForTimeout(800);
  await page.click('[data-expand="folders"]');
  await page.waitForTimeout(400);
  await page.click('[data-nav="folders-all"]');
  await page.waitForTimeout(1600);
}

try {
  step(1, 'Open the File Library and the seeded PDF');
  await signIn('e2e@example.com');
  await openLibrary();

  // Into the Contracts folder, then open the PDF. Rows are addressed by
  // data-id: the folder name also appears in the sidebar and in the hidden
  // grid view, so a bare text selector matches five elements, four invisible.
  const folderRow = page.locator('tr[data-type="folder"]:visible', { hasText: 'Contracts' }).first();
  await folderRow.dblclick();
  await page.waitForTimeout(1600);
  const fileRow = page.locator('tr[data-type="file"]:visible', { hasText: 'TMA Contract.pdf' }).first();
  check(await fileRow.count() > 0, 'seeded PDF is listed');
  await fileRow.dblclick();
  await page.waitForSelector('.tma-portal-viewer', { timeout: 8000 });
  await page.waitForTimeout(1200);

  step(2, 'Three regions exist, and the panel is one of them');
  check(!!(await page.$('.tma-portal-viewer__stage')), 'centre preview stage');
  check(!!(await page.$('.tma-portal-viewer__panel')), 'right details panel');
  check(!!(await page.$('.tma-portal-viewer__head')), 'header with file identity');
  const name = await page.textContent('.tma-portal-viewer__name');
  check(name.trim() === 'TMA Contract.pdf', `header names the file (got "${name.trim()}")`);
  const sub = await page.textContent('.tma-portal-viewer__sub');
  check(/Pdf|PDF/.test(sub) && /Modified/.test(sub), `header shows type + modified (got "${sub.trim()}")`);

  step(3, 'The preview really renders the PDF (not an icon fallback)');
  check(!!(await page.$('.tma-portal-viewer__frame-doc')), 'PDF renders in a document frame');

  step(4, 'Details tab shows real metadata from the server');
  await page.waitForTimeout(1200);
  let panel = await page.textContent('.tma-portal-viewer__panel-body');
  check(/TMA Contract\.pdf/.test(panel), 'panel shows the real file name');
  check(/Contracts/.test(panel), 'panel shows the real folder');
  check(/More details/.test(panel), '"More details" is present');
  // §30: it must be collapsed on open, not dumped.
  const moreOpen = await page.$eval('.tma-portal-viewer__more', (e) => e.hasAttribute('open')).catch(() => null);
  check(moreOpen === false, 'More details starts collapsed');

  await page.click('.tma-portal-viewer__more-summary');
  await page.waitForTimeout(400);
  panel = await page.textContent('.tma-portal-viewer__panel-body');
  check(/application\/pdf/.test(panel), 'expanded details show the real MIME type');
  check(/\/Contracts/.test(panel), 'expanded details show the portal path');
  // Nothing is in SharePoint, so those rows must be absent, not blank.
  check(!/SharePoint item ID/.test(panel), 'no empty SharePoint rows are shown');
  check(!/Sync status/.test(panel), 'no empty sync-status row is shown');

  step(5, 'Activity tab shows real logged events, filterable');
  await page.click('[data-lb-tab="activity"]');
  await page.waitForTimeout(1200);
  const activity = await page.textContent('.tma-portal-viewer__panel-body');
  check(/View:/.test(activity), 'the activity filter dropdown is present');
  const opts = await page.$$eval('[data-lb-filter] option', (o) => o.map((x) => x.textContent.trim()));
  check(opts.includes('All activity') && opts.includes('Comments') && opts.includes('Approvals'),
    `filter lists the documented views (${opts.length} options)`);

  // The seeded file was inserted directly, so it has no history — that must
  // read as empty, never as invented rows.
  check(/No activity recorded/.test(activity) || /Today|Yesterday/.test(activity),
    'activity is either real or an honest empty state');

  step(6, 'Downloading writes a real activity row that then appears');
  await page.click('[data-lb-act="download"]');
  await page.waitForTimeout(1500);
  await page.click('[data-lb-tab="details"]');
  await page.waitForTimeout(300);
  await page.click('[data-lb-tab="activity"]');
  await page.waitForTimeout(1500);
  const after = await page.textContent('.tma-portal-viewer__panel-body');
  check(/downloaded this file/.test(after), 'the download appears in the timeline');
  check(/Today/.test(after), 'it is grouped under "Today"');
  check(/You/.test(after), 'the actor reads "You" for your own action');

  step(7, 'Filtering narrows the timeline');
  await page.selectOption('[data-lb-filter]', 'shares');
  await page.waitForTimeout(1400);
  const shares = await page.textContent('.tma-portal-viewer__panel-body');
  check(/No activity of this kind/.test(shares), 'the Shares filter is honestly empty');
  await page.selectOption('[data-lb-filter]', 'downloads');
  await page.waitForTimeout(1400);
  check(/downloaded this file/.test(await page.textContent('.tma-portal-viewer__panel-body')),
    'the Downloads filter shows the download');

  step(8, 'Access tab reports sources, not a wall of users');
  await page.click('[data-lb-tab="access"]');
  await page.waitForTimeout(1400);
  const access = await page.textContent('.tma-portal-viewer__panel-body');
  check(/Owner/.test(access), 'the owner is listed as a source');
  check(/Administrators/.test(access), 'administrators are listed as a source');
  const sourceCount = await page.$$eval('.tma-portal-viewer__source', (n) => n.length);
  check(sourceCount > 0 && sourceCount < 10, `access is grouped into ${sourceCount} sources`);

  const firstSource = await page.$('.tma-portal-viewer__source-head');
  await firstSource.click();
  await page.waitForTimeout(400);
  check(!!(await page.$('.tma-portal-viewer__source-members')), 'a source expands to its members');
  const memberTitle = await page.$eval('.tma-portal-viewer__member', (e) => e.getAttribute('title')).catch(() => '');
  check(/@/.test(memberTitle || ''), `hovering a member reveals their email (title="${memberTitle}")`);

  step(8.5, 'The Access tab leads with a shared-with face stack');
  const stack = await page.$('[data-lb-shared-open]');
  check(!!stack, 'the face stack is present');
  if (stack) {
    const faces = await page.$$eval('.tma-portal-viewer__shared-stack img', (n) => n.length);
    check(faces >= 1 && faces <= 5, `it shows up to five faces (${faces})`);
    const summary = await page.textContent('.tma-portal-viewer__shared-text');
    check(/Shared with/.test(summary), `it says who with (“${summary.trim().replace(/\s+/g, ' ')}”)`);

    await stack.click();
    await page.waitForTimeout(700);
    const list = await page.textContent('.tma-portal-modal').catch(() => '');
    check(/@/.test(list), 'clicking it opens a list of the actual people');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  }

  step(9, 'Toolbar shows only permitted actions');
  const tools = await page.$$eval('[data-lb-act]', (n) => n.map((x) => x.getAttribute('data-lb-act')));
  check(tools.includes('download'), 'Download is offered (admin may download)');
  check(tools.includes('favorite'), 'Favourite is offered');
  check(tools.includes('share'), 'Share is offered');
  check(tools.includes('delete'), 'Delete is offered');
  check(tools.includes('more'), 'the three-dot menu is offered');

  step(10, 'The three-dot menu reuses the real file menu');
  await page.click('[data-lb-act="more"]');
  await page.waitForTimeout(500);
  const menu = await page.$('.tma-portal-context-menu');
  check(!!menu, 'the shared context-menu component opens');
  const menuText = await page.textContent('.tma-portal-context-menu');
  check(/View activity/.test(menuText), 'it adds "View activity"');
  check(!/^\s*Preview/.test(menuText), 'it drops "Preview" (the file is already open)');

  // Presence in the DOM proves nothing about visibility: the menu is z-index
  // 500 and the viewer is 600, so it first shipped rendering *behind* the
  // viewer — readable by this very test, invisible to a human. Hit-test it.
  const menuVisible = await page.evaluate(() => {
    const m = document.querySelector('.tma-portal-context-menu');
    if (!m) return false;
    const r = m.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + 20);
    return !!(hit && hit.closest('.tma-portal-context-menu'));
  });
  check(menuVisible, 'the menu is actually on top of the viewer, not behind it');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  step(11, '§29 — viewer state survives, nothing resets');
  // Favourite the file, then confirm the panel kept its tab and scroll.
  await page.click('[data-lb-tab="activity"]');
  await page.waitForTimeout(900);
  // Assert the *transition*, not an absolute value: favourite state persists
  // in the database, so a re-run against the same seed starts already starred
  // and would toggle it off.
  const before = await page.$eval('[data-lb-act="favorite"]', (e) => e.getAttribute('aria-pressed'));
  await page.click('[data-lb-act="favorite"]');
  await page.waitForTimeout(900);
  const stillActivity = await page.$eval('[data-lb-tab="activity"]', (e) => e.classList.contains('is-active'));
  check(stillActivity, 'the Activity tab is still selected after favouriting');
  check(!!(await page.$('.tma-portal-viewer')), 'the viewer did not close or reopen');
  const after2 = await page.$eval('[data-lb-act="favorite"]', (e) => e.getAttribute('aria-pressed'));
  check(after2 !== before, `the favourite button flipped (${before} → ${after2})`);

  step(12, 'Panel can be hidden and restored');
  await page.click('[data-lb-act="panel"]');
  await page.waitForTimeout(400);
  check(await page.$eval('[data-lb-panel]', (e) => e.hidden), 'panel hides');
  await page.click('[data-lb-act="panel"]');
  await page.waitForTimeout(600);
  check(!(await page.$eval('[data-lb-panel]', (e) => e.hidden)), 'panel comes back');

  step(13, 'Responsive — the panel becomes an overlay, the rail hides');
  await page.setViewportSize({ width: 700, height: 900 });
  await page.waitForTimeout(600);
  const railShown = await page.$eval('.tma-portal-viewer__rail',
    (e) => getComputedStyle(e).display !== 'none').catch(() => false);
  check(railShown === false, 'the thumbnail rail is hidden on a narrow screen');
  const panelPos = await page.$eval('.tma-portal-viewer__panel', (e) => getComputedStyle(e).position);
  check(panelPos === 'absolute', `the panel becomes an overlay drawer (position: ${panelPos})`);
  const scrollsX = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check(!scrollsX, 'the page does not scroll horizontally');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(400);

  step(14, 'Escape closes the viewer');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
  check(!(await page.$('.tma-portal-viewer')), 'the viewer closes');
} catch (e) {
  failures.push('threw: ' + e.message);
  await page.screenshot({ path: 'tests/Browser/file-viewer-error.png', fullPage: true }).catch(() => {});
} finally {
  if (!failures.length) {
    await page.screenshot({ path: 'tests/Browser/file-viewer.png' }).catch(() => {});
  }
  await browser.close();
  log('\n' + '='.repeat(52));
  if (errors.length) log('JS errors:\n  ' + errors.join('\n  '));
  if (failures.length) { log(`FAILED (${failures.length}):\n  ` + failures.join('\n  ')); process.exit(1); }
  log('Phase 1 viewer checks passed.');
}
