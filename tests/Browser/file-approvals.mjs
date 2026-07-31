import { chromium } from 'playwright';

/**
 * Phase 4 — review and approval requests in the file viewer.
 *
 * PHPUnit covers the state machine and every access rule
 * (tests/Feature/FileWorkflowTest). What only a browser proves is that the
 * request can actually be composed and answered from the viewer: pick people,
 * set the options, send, and have the approver see and answer it — with the
 * badge and the version-supersede warning showing what the spec asks for.
 *
 * Two browser contexts: the sender (admin) and the approver (staff).
 */
const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8899';
const failures = [];
const errors = [];
const log = (...a) => console.log(...a);
function step(n, m) { log(`\n[${n}] ${m}`); }
function check(ok, m) { log(`    ${ok ? '✓' : '✗'} ${m}`); if (!ok) failures.push(m); }

const browser = await chromium.launch();

async function signIn(page, email) {
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

const stamp = Date.now();
const NAME = `Approval ${stamp}.txt`;

const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/403|404/.test(m.text())) errors.push('console: ' + m.text()); });

try {
  step(1, 'Create a file both accounts can reach, then open it');
  await signIn(page, 'e2e@example.com');
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-expand="folders"]', { timeout: 15000 });
  await page.waitForTimeout(800);

  const setup = await page.evaluate(async ([base, name]) => {
    const csrf = decodeURIComponent((document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/) || [])[1] || '');
    const h = { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'X-XSRF-TOKEN': csrf };

    const form = new FormData();
    form.append('file', new File(['approval draft one'], name, { type: 'text/plain' }));
    const created = await fetch(base + '/portal/files/files', {
      method: 'POST', credentials: 'same-origin', headers: h, body: form,
    }).then((r) => r.json());

    // The approver must be able to OPEN the file, or the request would be
    // refused — which is the rule, not a workaround.
    const shared = await fetch(base + '/portal/files/shares', {
      method: 'POST', credentials: 'same-origin',
      headers: { ...h, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'file', id: created.id, mode: 'invite', email: 'bea@example.com', role: 'editor' }),
    });
    return { fileId: created.id, shareStatus: shared.status };
  }, [BASE, NAME]);
  check(!!setup.fileId, 'file created');
  check(setup.shareStatus === 201, `shared with the approver (HTTP ${setup.shareStatus})`);

  await page.click('[data-expand="folders"]');
  await page.waitForTimeout(400);
  await page.click('[data-nav="folders-all"]');
  await page.waitForTimeout(1800);
  await page.locator('tr[data-type="file"]:visible', { hasText: NAME }).first().dblclick();
  await page.waitForSelector('.tma-portal-viewer', { timeout: 8000 });
  await page.waitForTimeout(1500);

  step(2, 'The Approvals tab starts honest');
  await page.click('[data-lb-act="approvals"]');
  await page.waitForTimeout(1600);
  let panel = await page.textContent('.tma-portal-viewer__panel-body');
  check(/hasn’t been sent for review/.test(panel), 'empty state, not invented requests');
  check(/Send for approval/.test(panel), 'the send action is offered');

  step(3, 'Compose a request with real options');
  await page.click('[data-lb-send-wf="approval"]');
  await page.waitForTimeout(700);
  check(!!(await page.$('[data-wf-search]')), 'the send dialog opens');

  await page.fill('[data-wf-search]', 'Ben');
  await page.waitForTimeout(1500);
  const pickable = await page.$$('[data-wf-pick]');
  check(pickable.length > 0, `the approver is suggested (${pickable.length} people)`);
  await page.click('[data-wf-pick]');
  await page.waitForTimeout(400);
  check(/Ben Staff/.test(await page.textContent('[data-wf-chosen]')), 'they appear as a chip');

  await page.fill('[data-wf-message]', 'Please approve before Friday');
  await page.check('[data-wf-comment]');   // a comment is required
  await page.check('[data-wf-lock]');      // lock the file while open
  await page.click('[data-wf-send]');
  await page.waitForTimeout(2200);

  panel = await page.textContent('.tma-portal-viewer__panel-body');
  check(/Awaiting approval/.test(panel), 'the request shows as awaiting approval');
  check(/Please approve before Friday/.test(panel), 'the message is shown');
  check(/File locked/.test(panel), 'the lock setting is stated');
  check(/Reviewing version 1/.test(panel), 'it says which version is under review');

  step(4, 'The header carries the status badge (§20)');
  const sub = await page.textContent('.tma-portal-viewer__sub');
  check(/Awaiting approval/.test(sub), `header badge reads the status (“${sub.trim()}”)`);

  step(5, 'Locking really refuses a new version');
  const locked = await page.evaluate(async ([base, id]) => {
    const csrf = decodeURIComponent((document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/) || [])[1] || '');
    const form = new FormData();
    form.append('file', new File(['sneaky'], 'x.txt', { type: 'text/plain' }));
    const res = await fetch(`${base}/portal/files/files/${id}/versions`, {
      method: 'POST', credentials: 'same-origin',
      headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'X-XSRF-TOKEN': csrf },
      body: form,
    });
    return res.status;
  }, [BASE, setup.fileId]);
  check(locked === 403, `a new version is refused while locked (HTTP ${locked})`);

  step(6, 'The approver sees the request and must give a reason');
  const other = await browser.newContext();
  const page2 = await other.newPage({ viewport: { width: 1440, height: 900 } });
  await signIn(page2, 'bea@example.com');

  const notes = await page2.evaluate(async (base) => {
    const r = await fetch(base + '/portal/notifications', {
      headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      credentials: 'same-origin',
    }).then((res) => res.json());
    return (r.notifications || r.items || []).map((n) => n.type || '');
  }, BASE);
  check(notes.includes('file.approval_requested'), 'the approver was notified');

  await page2.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page2.waitForSelector('[data-expand="folders"]', { timeout: 15000 });
  await page2.waitForTimeout(800);
  await page2.click('[data-expand="folders"]');
  await page2.waitForTimeout(400);
  await page2.click('[data-nav="folders-sharedwithme"]');
  await page2.waitForTimeout(1800);
  await page2.locator('tr[data-type="file"]:visible', { hasText: NAME }).first().dblclick();
  await page2.waitForSelector('.tma-portal-viewer', { timeout: 8000 });
  await page2.click('[data-lb-act="approvals"]');
  await page2.waitForTimeout(1800);

  const approverPanel = await page2.textContent('.tma-portal-viewer__panel-body');
  check(/Please approve before Friday/.test(approverPanel), 'the approver sees the request');
  check(!!(await page2.$('[data-lb-wf-act="approve"]')), 'they are offered Approve');
  check(!!(await page2.$('[data-lb-wf-act="decline"]')), 'and Decline');
  check(!!(await page2.$('[data-lb-wf-act="request_changes"]')), 'and Request changes');

  // "Comment required" was ticked, so an empty approval must be refused.
  await page2.click('[data-lb-wf-act="approve"]');
  await page2.waitForTimeout(1800);
  const stillOpen = await page2.textContent('.tma-portal-viewer__panel-body');
  check(/Awaiting approval/.test(stillOpen), 'an empty approval is refused when a comment is required');

  step(7, 'Requesting changes halts the request');
  await page2.fill('[data-lb-wf-comment]', 'Clause 4 needs rewording');
  await page2.click('[data-lb-wf-act="request_changes"]');
  await page2.waitForTimeout(2200);
  const afterChanges = await page2.textContent('.tma-portal-viewer__panel-body');
  check(/Changes requested/.test(afterChanges), 'the request now reads Changes requested');
  check(/Clause 4 needs rewording/.test(afterChanges), 'the reason is recorded against the person');

  step(8, 'Closing the request unlocks the file again');
  await page.click('[data-lb-tab="details"]');
  await page.waitForTimeout(400);
  await page.click('[data-lb-tab="approvals"]');
  await page.waitForTimeout(2000);
  const unlocked = await page.evaluate(async ([base, id]) => {
    const csrf = decodeURIComponent((document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/) || [])[1] || '');
    const form = new FormData();
    form.append('file', new File(['approval draft two'], 'x.txt', { type: 'text/plain' }));
    const res = await fetch(`${base}/portal/files/files/${id}/versions`, {
      method: 'POST', credentials: 'same-origin',
      headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'X-XSRF-TOKEN': csrf },
      body: form,
    });
    return res.status;
  }, [BASE, setup.fileId]);
  check(unlocked === 201, `a new version is allowed once closed (HTTP ${unlocked})`);

  step(9, 'A second request, then a new version, shows the supersede warning');
  await page.click('[data-lb-send-wf="approval"]');
  await page.waitForTimeout(700);
  await page.fill('[data-wf-search]', 'Ben');
  await page.waitForTimeout(1500);
  await page.click('[data-wf-pick]');
  await page.waitForTimeout(300);
  await page.click('[data-wf-send]');   // no lock this time
  await page.waitForTimeout(2200);

  await page.evaluate(async ([base, id]) => {
    const csrf = decodeURIComponent((document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/) || [])[1] || '');
    const form = new FormData();
    form.append('file', new File(['approval draft three'], 'x.txt', { type: 'text/plain' }));
    await fetch(`${base}/portal/files/files/${id}/versions`, {
      method: 'POST', credentials: 'same-origin',
      headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'X-XSRF-TOKEN': csrf },
      body: form,
    });
  }, [BASE, setup.fileId]);

  await page.click('[data-lb-tab="details"]');
  await page.waitForTimeout(400);
  await page.click('[data-lb-tab="approvals"]');
  await page.waitForTimeout(2200);
  const superseded = await page.textContent('.tma-portal-viewer__panel-body');
  check(/has been uploaded since this was sent/.test(superseded),
    'the request warns that the file has moved on');
  check(/still refers to version/.test(superseded), 'and says which version it actually covers');

  step(10, 'Approvals reach the activity timeline');
  await page.click('[data-lb-tab="activity"]');
  await page.waitForTimeout(1400);
  await page.selectOption('[data-lb-filter]', 'approvals');
  await page.waitForTimeout(1600);
  const activity = await page.textContent('.tma-portal-viewer__panel-body');
  // Real sentences, not the raw action slug: "approval sent" reads as a bug.
  check(/sent this file for approval/.test(activity), 'events read as sentences');
  check(/requested changes/.test(activity), 'the changes-request is described');
  check(!/approval sent/.test(activity), 'no raw action slugs leak into the timeline');

  step(11, '§29 — none of this reloaded the page');
  check(!!(await page.$('.tma-portal-viewer')), 'the viewer is still open');

  await other.close();
} catch (e) {
  failures.push('threw: ' + e.message);
  await page.screenshot({ path: 'tests/Browser/file-approvals-error.png', fullPage: true }).catch(() => {});
} finally {
  if (!failures.length) await page.screenshot({ path: 'tests/Browser/file-approvals.png' }).catch(() => {});
  await browser.close();
  log('\n' + '='.repeat(52));
  if (errors.length) log('JS errors:\n  ' + errors.join('\n  '));
  if (failures.length) { log(`FAILED (${failures.length}):\n  ` + failures.join('\n  ')); process.exit(1); }
  log('Phase 4 approval checks passed.');
}
