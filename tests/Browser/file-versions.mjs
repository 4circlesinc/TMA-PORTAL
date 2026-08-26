import { chromium } from 'playwright';

/**
 * Phase 3 — version history in the file viewer.
 *
 * PHPUnit proves the storage guarantees (tests/Feature/FileVersionTest): that
 * old bytes survive, that restore appends instead of rewinding, that a viewer
 * cannot write. What only a browser proves is the workflow the spec describes:
 * upload a version with a note, see the history, open an old one, restore it —
 * and (§29) that doing so never reloads the page or resets the viewer.
 *
 * Needs the seeded harness: e2e@example.com and a "Contracts" folder with a PDF.
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
      page.click('button[type="submit"]:visible'),
    ]);
    await page.waitForTimeout(600);
  }
  if (page.url().includes('/auth/login')) throw new Error('login failed');
}

const stamp = Date.now();

try {
  step(1, 'Upload a fresh text file so this run owns its own history');
  await signIn('e2e@example.com');
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-expand="folders"]', { timeout: 15000 });
  await page.waitForTimeout(800);
  await page.click('[data-expand="folders"]');
  await page.waitForTimeout(400);
  await page.click('[data-nav="folders-all"]');
  await page.waitForTimeout(1600);

  const NAME = `Versioned ${stamp}.txt`;
  const created = await page.evaluate(async ([base, name]) => {
    const csrf = decodeURIComponent((document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/) || [])[1] || '');
    const form = new FormData();
    form.append('file', new File(['version one contents'], name, { type: 'text/plain' }));
    const res = await fetch(base + '/portal/files/files', {
      method: 'POST', credentials: 'same-origin',
      headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'X-XSRF-TOKEN': csrf },
      body: form,
    });
    return { status: res.status, file: await res.json() };
  }, [BASE, NAME]);
  check(created.status === 201, `file created (HTTP ${created.status})`);
  const fileId = created.file.id;

  await page.click('[data-nav="folders-all"]');
  await page.waitForTimeout(1800);
  await page.locator(`tr[data-type="file"]:visible`, { hasText: NAME }).first().dblclick();
  await page.waitForSelector('.tma-portal-viewer', { timeout: 8000 });
  await page.waitForTimeout(1200);

  step(2, 'A brand-new file already has version 1 in its history');
  await page.click('[data-lb-act="versions"]');
  await page.waitForTimeout(1600);
  let panel = await page.textContent('.tma-portal-viewer__panel-body');
  check(/v1/.test(panel), 'version 1 is listed');
  check(/Current/.test(panel), 'it is marked as current');
  check(/Upload new version/.test(panel), 'the upload action is offered');

  step(3, 'The header does not shout "Version 1" when there is no history');
  const sub1 = await page.textContent('.tma-portal-viewer__sub');
  check(!/Version/.test(sub1), `header stays quiet at v1 (“${sub1.trim()}”)`);

  step(4, 'Upload a second version with a note');
  // Drive the real endpoint the panel uses; the file chooser itself is native
  // and cannot be scripted, but everything after it is the product's path.
  const v2 = await page.evaluate(async ([base, id]) => {
    const csrf = decodeURIComponent((document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/) || [])[1] || '');
    const form = new FormData();
    form.append('file', new File(['version two contents'], 'anything.txt', { type: 'text/plain' }));
    form.append('note', 'Client asked for clause 4 to change');
    const res = await fetch(`${base}/portal/files/files/${id}/versions`, {
      method: 'POST', credentials: 'same-origin',
      headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'X-XSRF-TOKEN': csrf },
      body: form,
    });
    return { status: res.status, body: await res.json() };
  }, [BASE, fileId]);
  check(v2.status === 201, `version 2 uploaded (HTTP ${v2.status})`);
  check(v2.body.version === 2, `it is numbered 2 (got ${v2.body.version})`);

  await page.click('[data-lb-tab="details"]');
  await page.waitForTimeout(400);
  await page.click('[data-lb-tab="versions"]');
  await page.waitForTimeout(1800);
  panel = await page.textContent('.tma-portal-viewer__panel-body');
  check(/v2/.test(panel) && /v1/.test(panel), 'both versions are listed');
  check(/Client asked for clause 4 to change/.test(panel), 'the version note is shown');

  step(5, 'The older version keeps its own actions, the current one does not');
  const restoreBtns = await page.$$('[data-lb-vrestore]');
  check(restoreBtns.length === 1, `only the non-current version offers Restore (${restoreBtns.length})`);
  check((await page.$$('[data-lb-vdownload]')).length === 1, 'only the older version offers its own Download');

  step(6, 'An old version really serves its old bytes');
  const oldId = await page.$eval('[data-lb-vdownload]', (e) => e.getAttribute('data-lb-vdownload'));
  const oldBody = await page.evaluate(async ([base, id, vid]) => {
    const res = await fetch(`${base}/portal/files/files/${id}/versions/${vid}/preview`, { credentials: 'same-origin' });
    return { status: res.status, text: await res.text() };
  }, [BASE, fileId, oldId]);
  check(oldBody.status === 200 && oldBody.text === 'version one contents',
    `v1 still returns its original content (“${oldBody.text}”)`);

  const currentBody = await page.evaluate(async ([base, id]) => {
    const res = await fetch(`${base}/portal/files/files/${id}/preview`, { credentials: 'same-origin' });
    return await res.text();
  }, [BASE, fileId]);
  check(currentBody === 'version two contents', `the file itself serves v2 (“${currentBody}”)`);

  step(7, 'Restore appends — later history is never destroyed');
  await page.click('[data-lb-vrestore]');
  await page.waitForTimeout(700);
  const dialog = await page.$('.tma-portal-modal');
  check(!!dialog, 'the restore dialog opens');
  const dialogText = dialog ? await page.textContent('.tma-portal-modal') : '';
  check(/Nothing is deleted/.test(dialogText), 'it states plainly that nothing is deleted');
  check(!!(await page.$('[data-confirm-note]')), 'it offers a note field');

  // The dialog must be usable, not merely present — it opens over a z-index
  // 600 viewer, which has caught out the context menu here before.
  const dialogOnTop = await page.evaluate(() => {
    const m = document.querySelector('.tma-portal-modal');
    if (!m) return false;
    const r = m.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + 30);
    return !!(hit && hit.closest('.tma-portal-modal'));
  });
  check(dialogOnTop, 'the dialog is in front of the viewer, not behind it');

  await page.fill('[data-confirm-note]', 'Reverting the clause 4 change');
  await page.click('[data-confirm-ok]');
  await page.waitForTimeout(2500);

  panel = await page.textContent('.tma-portal-viewer__panel-body');
  check(/v3/.test(panel), 'a NEW version 3 was created');
  check(/v2/.test(panel) && /v1/.test(panel), 'versions 1 and 2 are still listed');
  check(/restored from v1/.test(panel), 'v3 says where it came from');
  check(/Reverting the clause 4 change/.test(panel), 'the restore note is kept');

  step(8, 'The restored content is really the old content');
  const afterRestore = await page.evaluate(async ([base, id]) => {
    const res = await fetch(`${base}/portal/files/files/${id}/preview`, { credentials: 'same-origin' });
    return await res.text();
  }, [BASE, fileId]);
  check(afterRestore === 'version one contents', `the file now serves v1's content (“${afterRestore}”)`);

  step(8.5, 'The preview itself re-rendered — not stuck on a placeholder');
  await page.waitForTimeout(1500);
  const stageText = await page.textContent('.tma-portal-viewer__stage');
  check(!/^\s*Loading…\s*$/.test(stageText), `the stage is not stuck loading (“${stageText.trim().slice(0, 40)}”)`);
  check(/version one contents/.test(stageText), 'the stage shows the restored content');

  step(9, 'The header now states the current version');
  const sub2 = await page.textContent('.tma-portal-viewer__sub');
  check(/Version 3/.test(sub2), `header reads Version 3 (“${sub2.trim()}”)`);

  step(10, '§29 — the viewer never reloaded through any of this');
  check(!!(await page.$('.tma-portal-viewer')), 'the viewer is still open');
  const tabActive = await page.$eval('[data-lb-tab="versions"]', (e) => e.classList.contains('is-active'));
  check(tabActive, 'the Versions tab is still selected');

  step(11, 'Versions show up in the activity timeline');
  await page.click('[data-lb-tab="activity"]');
  await page.waitForTimeout(1400);
  await page.selectOption('[data-lb-filter]', 'versions');
  await page.waitForTimeout(1600);
  const activity = await page.textContent('.tma-portal-viewer__panel-body');
  check(/version/i.test(activity), 'the Versions activity filter shows version events');

  step(12, 'Comments survive a version change');
  await page.click('[data-lb-act="comments"]');
  await page.waitForTimeout(1400);
  await page.fill('[data-lb-input]', 'Comment that must outlive a version ' + stamp);
  await page.click('[data-lb-send]');
  await page.waitForTimeout(1800);

  await page.evaluate(async ([base, id]) => {
    const csrf = decodeURIComponent((document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/) || [])[1] || '');
    const form = new FormData();
    form.append('file', new File(['version four'], 'x.txt', { type: 'text/plain' }));
    await fetch(`${base}/portal/files/files/${id}/versions`, {
      method: 'POST', credentials: 'same-origin',
      headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'X-XSRF-TOKEN': csrf },
      body: form,
    });
  }, [BASE, fileId]);

  await page.click('[data-lb-tab="versions"]');
  await page.waitForTimeout(1400);
  // Comments may already be open; ensure the floating feed is visible.
  if (await page.$eval('[data-lb-comments-panel]', (e) => e.hidden)) {
    await page.click('[data-lb-act="comments"]');
  }
  await page.waitForTimeout(1800);
  const comments = await page.textContent('[data-lb-comments-body]');
  check(comments.includes('Comment that must outlive a version ' + stamp),
    'the discussion is about the file, not one revision of it');
} catch (e) {
  failures.push('threw: ' + e.message);
  await page.screenshot({ path: 'tests/Browser/file-versions-error.png', fullPage: true }).catch(() => {});
} finally {
  if (!failures.length) await page.screenshot({ path: 'tests/Browser/file-versions.png' }).catch(() => {});
  await browser.close();
  log('\n' + '='.repeat(52));
  if (errors.length) log('JS errors:\n  ' + errors.join('\n  '));
  if (failures.length) { log(`FAILED (${failures.length}):\n  ` + failures.join('\n  ')); process.exit(1); }
  log('Phase 3 version checks passed.');
}
