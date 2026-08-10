import { chromium } from 'playwright';

/**
 * The Workflows section — Requests, and Feedback and Comments.
 *
 * `WorkflowHubTest` covers the queries and every access rule. What only a
 * browser proves is that the page is actually usable away from the file: that
 * a request addressed to you shows up on a page you can reach from the
 * sidebar, that you can answer it from there without opening the file, and
 * that a comment naming you can be replied to and resolved in place.
 *
 * Two browser contexts: the sender (admin) and the person being asked.
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

/** Park the pointer clear of the sidebar — Hover Overlay expands over the page. */
async function parkPointer(page) {
  await page.mouse.move(1200, 500);
  await page.waitForTimeout(150);
}

/**
 * Wait for the list to actually say something, rather than for a number of
 * milliseconds.
 *
 * Every action here is two round trips — the write, then the reload it
 * triggers — and `artisan serve` runs a single PHP worker, so a fixed wait
 * that passes on a quiet machine reads the pre-action list on a busy one.
 */
async function waitForBody(page, re, timeout = 20000) {
  const until = Date.now() + timeout;
  let last = '';

  while (Date.now() < until) {
    last = (await page.textContent('[data-wfh-body]').catch(() => '')) || '';
    if (re.test(last)) return last;
    await page.waitForTimeout(300);
  }

  return last;
}

const stamp = Date.now();
const NAME = `Hub ${stamp}.txt`;
const QUESTION = `Bea, does clause ${stamp} read right?`;
const ANSWER = `Clause ${stamp} is fine.`;
const VERDICT = `Approved ${stamp}.`;

const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/403|404/.test(m.text())) errors.push('console: ' + m.text()); });

const bea = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const beaPage = await bea.newPage();
beaPage.on('pageerror', (e) => errors.push('bea pageerror: ' + e.message));

try {
  step(1, 'The admin creates a file, sends it for approval, and names Bea in a comment');
  await signIn(page, 'e2e@example.com');
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-expand="folders"]', { timeout: 15000 });
  await page.waitForTimeout(800);

  const setup = await page.evaluate(async ([base, name, question]) => {
    const csrf = decodeURIComponent((document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/) || [])[1] || '');
    const h = { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'X-XSRF-TOKEN': csrf };
    const json = { ...h, 'Content-Type': 'application/json' };

    const form = new FormData();
    form.append('file', new File(['hub draft one'], name, { type: 'text/plain' }));
    const file = await fetch(base + '/portal/files/files', {
      method: 'POST', credentials: 'same-origin', headers: h, body: form,
    }).then((r) => r.json());

    const people = await fetch(base + '/portal/files/files/' + file.id + '/mentionable?q=Bea', {
      credentials: 'same-origin', headers: h,
    }).then((r) => r.json());
    const beaId = (people.people || []).map((p) => p.id)[0];

    const wf = await fetch(base + '/portal/files/files/' + file.id + '/workflows', {
      method: 'POST', credentials: 'same-origin', headers: json,
      body: JSON.stringify({
        type: 'approval',
        recipients: [{ userId: beaId }],
        message: 'Please approve before Friday',
      }),
    });

    const comment = await fetch(base + '/portal/files/files/' + file.id + '/comments', {
      method: 'POST', credentials: 'same-origin', headers: json,
      body: JSON.stringify({ body: question, mentions: [beaId] }),
    });

    return { fileId: file.id, beaId, wfStatus: wf.status, commentStatus: comment.status };
  }, [BASE, NAME, QUESTION]);

  check(!!setup.fileId, 'file created');
  check(!!setup.beaId, 'Bea was found as a mentionable person');
  check(setup.wfStatus === 201, `approval request sent (HTTP ${setup.wfStatus})`);
  check(setup.commentStatus === 201, `comment naming Bea posted (HTTP ${setup.commentStatus})`);

  step(2, 'The sender sees it in Sent by you');
  await parkPointer(page);
  await page.goto(`${BASE}/workflows`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.tma-portal-page--workflows', { timeout: 15000 });

  let body = await waitForBody(page, /Nothing is waiting on you/);
  check(/Nothing is waiting on you/.test(body), 'the admin has nothing waiting on them');

  await page.click('.tma-portal-page--workflows [data-tab-key="sent"]');
  body = await waitForBody(page, new RegExp(NAME));
  check(body.includes(NAME), 'the file is named on the request');
  check(/Waiting on Bea/.test(body), 'it says who it is waiting on, by name');
  check(/Please approve before Friday/.test(body), 'the message travels with it');
  check(/Cancel request/.test(body), 'the sender is offered the cancel action');

  step(3, 'Bea sees it waiting on her, and answers without opening the file');
  await signIn(beaPage, 'bea@example.com');
  await beaPage.goto(`${BASE}/workflows`, { waitUntil: 'domcontentloaded' });
  await beaPage.waitForSelector('.tma-portal-page--workflows', { timeout: 15000 });

  body = await waitForBody(beaPage, /Your response is needed/);
  check(/Your response is needed/.test(body), 'it leads with whose turn it is');
  check(body.includes(NAME), 'the file is named');
  check(/Approve/.test(body) && /Request changes/.test(body), 'the approval actions are offered');

  const tabs = await beaPage.textContent('.tma-portal-page--workflows .tma-tab-group');
  check(/Waiting on you \(1\)/.test(tabs), `the tab carries the count (got: ${tabs.replace(/\s+/g, ' ').trim()})`);

  await parkPointer(beaPage);
  await beaPage.fill('[data-wfh-comment]', VERDICT);
  await parkPointer(beaPage);
  await beaPage.click('[data-wfh-act="approve"]');

  body = await waitForBody(beaPage, /Nothing is waiting on you/);
  check(/Nothing is waiting on you/.test(body), 'answering takes it off her list');

  const afterTabs = await beaPage.textContent('.tma-portal-page--workflows .tma-tab-group');
  check(!/Waiting on you \(/.test(afterTabs), `and off the tab count (got: ${afterTabs.replace(/\s+/g, ' ').trim()})`);

  step(4, 'The sender sees the outcome');
  await parkPointer(page);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.tma-portal-page--workflows', { timeout: 15000 });
  await page.click('.tma-portal-page--workflows [data-tab-key="sent"]');
  body = await waitForBody(page, /Nothing/, 8000);
  check(!body.includes(NAME), 'a finished request leaves the open list');

  await page.selectOption('[data-wfh-state]', 'closed');
  body = await waitForBody(page, new RegExp(NAME));
  check(/Approved/.test(body), 'and is found under Finished, approved');
  check(body.includes(VERDICT), 'with the approver’s comment attached');

  step(5, 'Feedback and Comments shows the mention, and can be answered in place');
  await parkPointer(beaPage);
  await beaPage.goto(`${BASE}/workflows/feedback`, { waitUntil: 'domcontentloaded' });
  await beaPage.waitForSelector('.tma-portal-page--workflows', { timeout: 15000 });

  const heading = await beaPage.textContent('.tma-portal-head__title');
  check(/Feedback and Comments/.test(heading), `the page names itself (got: ${heading})`);

  body = await waitForBody(beaPage, new RegExp(QUESTION));
  check(body.includes(QUESTION), 'the comment is shown in full');
  check(/Mentioned you/.test(body), 'and is marked as naming her');
  check(body.includes(NAME), 'the file it is about is named');

  await parkPointer(beaPage);
  await beaPage.click(`.tma-portal-wf-card:has-text("${QUESTION}") [data-wfh-reply]`);
  await beaPage.waitForTimeout(400);
  await parkPointer(beaPage);
  await beaPage.fill('[data-wfh-reply-body]', ANSWER);
  await parkPointer(beaPage);
  await beaPage.click('[data-wfh-reply-send]');

  body = await waitForBody(beaPage, new RegExp(ANSWER));
  check(body.includes(ANSWER), 'the reply posted and appears in the list');

  step(6, 'Open threads is a real filter, and resolving empties it');
  await parkPointer(beaPage);
  await beaPage.click('.tma-portal-page--workflows [data-tab-key="unresolved"]');
  body = await waitForBody(beaPage, new RegExp(QUESTION));
  check(body.includes(QUESTION), 'the open thread is listed');
  check(!body.includes(ANSWER), 'the reply is not — a reply is not a thread');

  /*
   * Bea is not offered Resolve, and that is the rule, not a gap: closing a
   * question belongs to whoever asked it or whoever controls the file. She was
   * given this file only so she could answer the approval.
   */
  check(!(await beaPage.$(`.tma-portal-wf-card:has-text("${QUESTION}") [data-wfh-resolve]`)),
    'she is not offered a resolve she may not do');

  await parkPointer(page);
  await page.goto(`${BASE}/workflows/feedback`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.tma-portal-page--workflows', { timeout: 15000 });
  await waitForBody(page, new RegExp(QUESTION));
  const resolve = `.tma-portal-wf-card:has-text("${QUESTION}") [data-wfh-resolve]`;
  check(!!(await page.$(resolve)), 'the author is');
  await page.click(resolve);
  await page.waitForTimeout(1200);

  await parkPointer(beaPage);
  await beaPage.reload({ waitUntil: 'domcontentloaded' });
  await beaPage.waitForSelector('.tma-portal-page--workflows', { timeout: 15000 });
  await parkPointer(beaPage);
  await beaPage.click('.tma-portal-page--workflows [data-tab-key="unresolved"]');
  body = await waitForBody(beaPage, /No open threads/);
  check(/No open threads/.test(body), 'resolving it empties her open-threads tab too');

  step(7, 'The file is one click away from every row');
  await parkPointer(beaPage);
  await beaPage.click('.tma-portal-page--workflows [data-tab-key="mine"]');
  await waitForBody(beaPage, new RegExp(QUESTION));
  await parkPointer(beaPage);
  await beaPage.click(`.tma-portal-wf-card:has-text("${QUESTION}") [data-wfh-open]`);
  await beaPage.waitForSelector('.tma-portal-viewer', { timeout: 20000 }).catch(() => {});
  check(/\/folders/.test(beaPage.url()), `it lands in the library (${beaPage.url()})`);
  check(!!(await beaPage.$('.tma-portal-viewer')), 'with the viewer open on the file');
  const viewer = (await beaPage.textContent('.tma-portal-viewer').catch(() => '')) || '';
  check(viewer.includes(NAME), 'and it is the right file');
} catch (e) {
  failures.push('threw: ' + e.message);
  log('\n!! ' + e.stack);
  await page.screenshot({ path: 'tests/Browser/workflows-hub-error.png' }).catch(() => {});
}

await page.screenshot({ path: 'tests/Browser/workflows-hub.png', fullPage: true }).catch(() => {});
await browser.close();

log('\n' + '─'.repeat(60));
if (errors.length) { log('Page errors:'); errors.forEach((e) => log('  ' + e)); }
if (failures.length) {
  log(`FAILED (${failures.length})`);
  failures.forEach((f) => log('  ✗ ' + f));
  process.exit(1);
}
log('All checks passed.');
