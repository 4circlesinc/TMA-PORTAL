import { chromium } from 'playwright';

/**
 * Phase 2 — comments in the file viewer.
 *
 * PHPUnit covers the API and every access rule (tests/Feature/FileCommentTest).
 * What only a browser proves is the part the spec actually asks for: comment
 * without leaving the viewer, mention someone from a live suggestion list,
 * reply/edit/delete/resolve in place — and (§29) that none of it reloads the
 * page or resets the viewer.
 *
 * The second half opens a SECOND browser context on another account to prove
 * a comment arrives live, which a single session can never demonstrate.
 *
 * Needs the seeded harness: e2e@example.com (admin), bea@example.com (staff),
 * and the "Contracts" folder holding a real PDF. The file must be reachable by
 * both, so this script shares it first.
 */
const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8899';
const failures = [];
const errors = [];
const log = (...a) => console.log(...a);
function step(n, m) { log(`\n[${n}] ${m}`); }
function check(ok, m) { log(`    ${ok ? '✓' : '✗'} ${m}`); if (!ok) failures.push(m); }

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
  await page.waitForTimeout(600);
  if (page.url().includes('/auth/stay-signed-in')) {
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}),
      page.click('text=Yes, stay signed in'),
    ]);
    await page.waitForTimeout(600);
  }
  if (page.url().includes('/auth/login')) throw new Error('login failed for ' + email);
}

async function openFile(page) {
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await page.click('[data-expand="folders"]');
  await page.waitForTimeout(400);
  await page.click('[data-nav="folders-all"]');
  await page.waitForTimeout(1600);
  await page.locator('tr[data-type="file"]:visible', { hasText: FILE_NAME }).first().dblclick();
  await page.waitForSelector('.tma-portal-viewer', { timeout: 8000 });
  await page.waitForTimeout(1200);
}

/**
 * The second account was shared the FILE, not its folder — so "Contracts" is
 * correctly invisible to them and they reach the file through Shared with me.
 * (Navigating them to the folder is what the first version of this script got
 * wrong, and it looked exactly like a broken share.)
 */
async function openSharedFile(page) {
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await page.click('[data-expand="folders"]');
  await page.waitForTimeout(400);
  await page.click('[data-nav="folders-sharedwithme"]');
  await page.waitForTimeout(1800);
  await page.locator('tr[data-type="file"]:visible', { hasText: FILE_NAME }).first().dblclick();
  await page.waitForSelector('.tma-portal-viewer', { timeout: 8000 });
  await page.waitForTimeout(1200);
}

const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/403|404/.test(m.text())) errors.push('console: ' + m.text()); });

const stamp = Date.now();
const FILE_NAME = `Comments ${stamp}.txt`;
const BODY = 'Phase two comment ' + stamp;
const REPLY = 'A reply ' + stamp;

try {
  step(1, 'Create a file this run owns, and share it with the second account');
  await signIn(page, 'e2e@example.com');
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);

  // A fresh file per run. Reusing one seeded file accumulated 20+ threads
  // across runs, which paginated the panel and made this script flaky for
  // reasons that had nothing to do with commenting.
  const shared = await page.evaluate(async ([base, name]) => {
    const csrf = decodeURIComponent((document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/) || [])[1] || '');
    const h = { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'X-XSRF-TOKEN': csrf };
    const form = new FormData();
    form.append('file', new File(['comment probe'], name, { type: 'text/plain' }));
    const created = await fetch(base + '/portal/files/files', {
      method: 'POST', credentials: 'same-origin', headers: h, body: form,
    }).then((r) => r.json());
    const fileId = created.id;
    const res = await fetch(base + '/portal/files/shares', {
      method: 'POST', credentials: 'same-origin',
      // ShareController wants `mode`, not `kind` — the wrong key 422s and the
      // second account silently never gets access, which then looks like a
      // broken mention list and a broken notification.
      headers: { ...h, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'file', id: fileId, mode: 'invite', email: 'bea@example.com', role: 'editor' }),
    });
    return { status: res.status, body: await res.text(), fileId };
  }, [BASE, FILE_NAME]);
  check(shared.status === 200 || shared.status === 201,
    `the file was shared with the second account (HTTP ${shared.status}) ${shared.status >= 400 ? shared.body : ''}`);

  await openFile(page);

  step(2, 'The Comments tab exists and starts honest');
  await page.click('[data-lb-act="comments"]');
  await page.waitForTimeout(1500);
  let panel = await page.textContent('.tma-portal-viewer__panel-body');
  check(/No comments yet|Phase two comment/.test(panel), 'empty state or real comments — never invented ones');
  check(!!(await page.$('[data-lb-input]')), 'the composer is present inside the viewer');

  step(3, 'Post a comment without leaving the viewer');
  await page.fill('[data-lb-input]', BODY);
  await page.click('[data-lb-send]');
  await page.waitForTimeout(1800);
  panel = await page.textContent('.tma-portal-viewer__panel-body');
  check(panel.includes(BODY), 'the comment appears in the thread');
  check(!!(await page.$('.tma-portal-viewer')), 'the viewer never closed');
  check((await page.$eval('[data-lb-input]', (e) => e.value)) === '', 'the composer cleared');

  step(4, 'The tab badge counts open threads');
  const tabText = await page.textContent('[data-lb-tab="comments"]');
  check(/Comments \(\d+\)/.test(tabText), `tab shows an open count (${tabText})`);

  step(5, 'Mention autocomplete offers only people who can open the file');
  await page.fill('[data-lb-input]', 'Hello @Ben');
  await page.waitForTimeout(1500);
  const popVisible = await page.$eval('[data-lb-mentions]', (e) => !e.hidden).catch(() => false);
  check(popVisible, 'the mention suggestion list opened');
  if (popVisible) {
    const names = await page.$$eval('.tma-portal-viewer__mention-item', (n) => n.map((x) => x.textContent.trim()));
    check(names.some((n) => /Ben Staff/.test(n)), `the shared-with user is suggested (${names.length} shown)`);
    await page.click('.tma-portal-viewer__mention-item');
    await page.waitForTimeout(400);
    const value = await page.$eval('[data-lb-input]', (e) => e.value);
    check(/@Ben Staff/.test(value), `picking inserts the name (“${value}”)`);
    await page.click('[data-lb-send]');
    await page.waitForTimeout(1800);
  }

  step(6, 'Reply threads under the comment');
  await page.click('.tma-portal-viewer__reply-open');
  await page.waitForTimeout(400);
  await page.fill('[data-lb-replyinput]', REPLY);
  await page.click('[data-lb-replysend]');
  await page.waitForTimeout(1800);
  panel = await page.textContent('.tma-portal-viewer__panel-body');
  check(panel.includes(REPLY), 'the reply appears');
  check(!!(await page.$('.tma-portal-viewer__reply')), 'it is rendered as a reply, indented under its thread');

  step(7, 'Edit marks the comment as edited');
  await page.click('[data-lb-edit]');
  await page.waitForTimeout(400);
  await page.fill('[data-lb-editinput]', BODY + ' (edited)');
  await page.click('[data-lb-editsave]');
  await page.waitForTimeout(1800);
  panel = await page.textContent('.tma-portal-viewer__panel-body');
  check(panel.includes(BODY + ' (edited)'), 'the edited text is shown');
  check(/edited/.test(panel), 'it is flagged as edited');

  step(8, 'Emoji insert at the caret');
  await page.fill('[data-lb-input]', 'Nice ');
  await page.click('[data-lb-emoji]');
  await page.waitForTimeout(500);
  check(!!(await page.$('[data-lb-emojipop]')), 'the emoji picker opens');
  await page.click('.tma-portal-viewer__emoji');
  await page.waitForTimeout(400);
  const withEmoji = await page.$eval('[data-lb-input]', (e) => e.value);
  check(withEmoji.length > 'Nice '.length, `an emoji was inserted (“${withEmoji}”)`);
  await page.click('[data-lb-clear]');
  await page.waitForTimeout(300);
  check((await page.$eval('[data-lb-input]', (e) => e.value)) === '', 'Cancel clears the composer');

  step(9, 'Resolve closes the thread and drops the open count');
  // Let any in-flight refetch land first: the panel repaints asynchronously,
  // and clicking into a node that is about to be replaced silently does
  // nothing. Then assert on THIS run's thread, not on global counts — the
  // database keeps comments between runs.
  await page.waitForTimeout(2000);
  const myThread = page.locator('.tma-portal-viewer__thread', { hasText: BODY }).first();
  await myThread.locator('[data-lb-resolve]').first().click();

  // Poll for the outcome rather than sleeping a guessed amount. The panel
  // repaints asynchronously after several earlier steps in this script, so a
  // fixed wait is a coin toss — this was intermittently red for that reason
  // alone, with the underlying resolve working every time.
  const resolvedThread = page.locator('.tma-portal-viewer__thread.is-resolved', { hasText: BODY }).first();
  let isResolved = false;
  for (let i = 0; i < 24 && !isResolved; i++) {
    await page.waitForTimeout(500);
    isResolved = (await resolvedThread.count()) > 0;
  }
  if (!isResolved) {
    // Self-explaining failure: this check has been intermittently red and
    // guessing at it wastes runs.
    const diag = await page.evaluate((body) => {
      const threads = [...document.querySelectorAll('.tma-portal-viewer__thread')];
      const mine = threads.find((n) => n.textContent.includes(body));
      return {
        threadCount: threads.length,
        mineFound: !!mine,
        mineClass: mine ? mine.className : null,
        resolveButtons: mine ? [...mine.querySelectorAll('[data-lb-resolve]')]
          .map((b) => b.textContent + '/' + b.getAttribute('data-resolved')) : [],
        panelHead: document.querySelector('.tma-portal-viewer__panel-body')?.textContent.slice(0, 120),
      };
    }, BODY);
    log('    diagnostic: ' + JSON.stringify(diag));
  }
  check(isResolved, 'the thread this run created is marked resolved');
  check(/Resolved/.test(await page.textContent('.tma-portal-viewer__panel-body')),
    'it is labelled Resolved');
  check((await resolvedThread.textContent()).includes(BODY),
    'the resolved thread is still readable, not hidden');

  step(10, 'Comments show up in the activity timeline');
  await page.click('[data-lb-tab="activity"]');
  await page.waitForTimeout(1600);
  await page.selectOption('[data-lb-filter]', 'comments');
  await page.waitForTimeout(1600);
  const activity = await page.textContent('.tma-portal-viewer__panel-body');
  check(/comment/i.test(activity), 'the Comments activity filter shows the comment events');

  step(11, '§29 — the draft survives a tab switch');
  await page.click('[data-lb-tab="comments"]');
  await page.waitForTimeout(1400);
  await page.fill('[data-lb-input]', 'half-typed thought');
  await page.click('[data-lb-tab="details"]');
  await page.waitForTimeout(500);
  await page.click('[data-lb-tab="comments"]');
  await page.waitForTimeout(1400);
  const draft = await page.$eval('[data-lb-input]', (e) => e.value);
  check(draft === 'half-typed thought', `the half-typed comment survived (“${draft}”)`);
  await page.click('[data-lb-clear]');

  step(12, 'A second person sees the comment, and is notified');
  const other = await browser.newContext();
  const page2 = await other.newPage();
  await signIn(page2, 'bea@example.com');

  // Notification for the earlier @mention.
  const notes = await page2.evaluate(async (base) => {
    const r = await fetch(base + '/portal/notifications', {
      headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      credentials: 'same-origin',
    }).then((res) => res.json());
    return (r.notifications || r.items || []).map((n) => n.type || '');
  }, BASE);
  check(notes.some((t) => /file\.(mention|comment)/.test(t)),
    `the second account was notified (${JSON.stringify(notes.slice(0, 4))})`);

  await openSharedFile(page2);
  await page2.click('[data-lb-act="comments"]');
  await page2.waitForTimeout(1800);
  const seen = await page2.textContent('.tma-portal-viewer__panel-body');
  check(seen.includes(BODY + ' (edited)'), 'the other person sees the comment');
  check(seen.includes(REPLY), 'and the reply');

  step(13, 'A comment posted now arrives live, without a reload');
  // A sentinel proves the page never navigated: any reload wipes it.
  await page2.evaluate(() => { window.__tmaSentinel = 'alive'; });
  const LIVE = 'Live comment ' + stamp;
  await page.click('[data-lb-tab="comments"]');
  await page.waitForTimeout(1000);
  await page.fill('[data-lb-input]', LIVE);
  await page.click('[data-lb-send]');

  let arrived = false;
  for (let i = 0; i < 20 && !arrived; i++) {
    await page2.waitForTimeout(500);
    arrived = (await page2.textContent('.tma-portal-viewer__panel-body')).includes(LIVE);
  }
  check(arrived, 'the new comment appeared in the other browser without a reload');
  check(await page2.evaluate(() => window.__tmaSentinel === 'alive'),
    'the second page never navigated (sentinel intact)');

  step(14, 'The author does not see their own comment twice');
  await page.waitForTimeout(1500);
  const mine = await page.textContent('.tma-portal-viewer__panel-body');
  const occurrences = mine.split(LIVE).length - 1;
  check(occurrences === 1, `the author's own comment renders exactly once (found ${occurrences})`);

  await other.close();
} catch (e) {
  failures.push('threw: ' + e.message);
  await page.screenshot({ path: 'tests/Browser/file-comments-error.png', fullPage: true }).catch(() => {});
} finally {
  if (!failures.length) await page.screenshot({ path: 'tests/Browser/file-comments.png' }).catch(() => {});
  await browser.close();
  log('\n' + '='.repeat(52));
  if (errors.length) log('JS errors:\n  ' + errors.join('\n  '));
  if (failures.length) { log(`FAILED (${failures.length}):\n  ` + failures.join('\n  ')); process.exit(1); }
  log('Phase 2 comment checks passed.');
}
