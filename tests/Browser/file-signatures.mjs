import { chromium } from 'playwright';

/**
 * Phase 5 — signature requests seen from the file viewer.
 *
 * The signing round trip itself is already covered end to end by
 * signing-flow.mjs and stamped-output.mjs. What this adds is the File Library
 * side: that a request made against a library file shows on that file with a
 * real status and recipient list, that the badge says so, and that "Send for
 * signature" is offered for signable files and withheld for the rest.
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

async function openLibrary() {
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-expand="folders"]', { timeout: 15000 });
  await page.waitForTimeout(800);
  await page.click('[data-expand="folders"]');
  await page.waitForTimeout(400);
  await page.click('[data-nav="folders-all"]');
  await page.waitForTimeout(1800);
}

try {
  step(1, 'Open the seeded PDF in the viewer');
  await signIn('e2e@example.com');
  await openLibrary();
  await page.locator('tr[data-type="folder"]:visible', { hasText: 'Contracts' }).first().dblclick();
  await page.waitForTimeout(1600);
  await page.locator('tr[data-type="file"]:visible', { hasText: 'TMA Contract.pdf' }).first().dblclick();
  await page.waitForSelector('.tma-portal-viewer', { timeout: 8000 });
  await page.waitForTimeout(1500);

  // Scope to the visible PDF row: an unscoped tr[data-type="file"] picks up
  // rows left in the DOM by the previous listing, which is how this first
  // grabbed a .txt and got "TXT files can't be sent for signature".
  const fileId = await page.locator('tr[data-type="file"]:visible', { hasText: 'TMA Contract.pdf' })
    .first().getAttribute('data-id');

  step(2, 'A PDF is offered "Send for signature"');
  await page.click('[data-lb-act="approvals"]');
  await page.waitForTimeout(1800);
  check(!!(await page.$('[data-lb-send-signature]')), 'the action is offered for a PDF');

  step(3, 'It explains that the original is never changed');
  await page.click('[data-lb-send-signature]');
  await page.waitForTimeout(700);
  const dialog = await page.textContent('.tma-portal-modal').catch(() => '');
  check(/original file is never changed/.test(dialog), 'the dialog states the original is preserved');
  check(/signature editor/.test(dialog), 'and that field placement happens in the editor');
  // Back out — the handoff navigates away, which the signature suite covers.
  await page.click('[data-confirm-cancel]');
  await page.waitForTimeout(500);

  step(4, 'A real signature request appears on the file');
  const sent = await page.evaluate(async ([base, id]) => {
    const csrf = decodeURIComponent((document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/) || [])[1] || '');
    const h = {
      'Content-Type': 'application/json', Accept: 'application/json',
      'X-Requested-With': 'XMLHttpRequest', 'X-XSRF-TOKEN': csrf,
    };
    const post = (url, body, method) => fetch(base + url, {
      method: method || 'POST', credentials: 'same-origin', headers: h,
      body: JSON.stringify(body || {}),
    });

    // Create it the way the editor does: from the library file.
    const createRes = await post('/portal/signatures', { fileId: id });
    if (!createRes.ok) return { stage: 'create', status: createRes.status, body: await createRes.text() };
    const created = await createRes.json();
    const reqId = created.request.id;

    // Recipients use `order`, not `signingOrder` — the wrong key 422s.
    const patchRes = await post(`/portal/signatures/${reqId}`, {
      recipients: [{ name: 'Dana Reed', email: 'dana@example.com', role: 'signer', order: 1 }],
    }, 'PATCH');
    if (!patchRes.ok) return { stage: 'recipients', status: patchRes.status, body: await patchRes.text() };
    const patched = await patchRes.json();
    const recipient = (patched.request.recipients || [])[0];

    // Fields address their recipient by `recipient` (a uuid), not recipientId.
    const fieldRes = await post(`/portal/signatures/${reqId}/fields`, {
      fields: [{
        recipient: recipient.id, type: 'signature', page: 1,
        x: 0.2, y: 0.7, width: 0.3, height: 0.08, required: true,
      }],
    }, 'PUT');
    if (!fieldRes.ok) return { stage: 'fields', status: fieldRes.status, body: await fieldRes.text() };

    const send = await post(`/portal/signatures/${reqId}/send`, {});
    return { stage: 'send', reqId, sendStatus: send.status, sendBody: await send.text() };
  }, [BASE, fileId]);

  check(sent.stage === 'send' && (sent.sendStatus === 200 || sent.sendStatus === 201),
    `the request was created, addressed, fielded and sent` +
    (sent.stage !== 'send' ? ` — failed at ${sent.stage} (HTTP ${sent.status}): ${String(sent.body).slice(0, 160)}`
      : ` (HTTP ${sent.sendStatus})${sent.sendStatus >= 400 ? ' ' + sent.sendBody.slice(0, 160) : ''}`));

  step(5, 'The viewer shows it as awaiting signature');
  await page.click('[data-lb-tab="details"]');
  await page.waitForTimeout(400);
  await page.click('[data-lb-tab="approvals"]');
  await page.waitForTimeout(2200);
  const panel = await page.textContent('.tma-portal-viewer__panel-body');
  check(/Awaiting signature/.test(panel), 'the request reads Awaiting signature');
  check(/Dana Reed/.test(panel), 'the recipient is listed');
  check(/Signature/i.test(panel), 'it is labelled as a signature request');

  step(6, 'The header badge reflects it (§20/§23)');
  const sub = await page.textContent('.tma-portal-viewer__sub');
  check(/Awaiting signature/.test(sub), `header badge reads the status (“${sub.trim()}”)`);

  step(7, 'It shows in the Signatures activity filter');
  await page.click('[data-lb-tab="activity"]');
  await page.waitForTimeout(1400);
  await page.selectOption('[data-lb-filter]', 'signatures');
  await page.waitForTimeout(1600);
  const activity = await page.textContent('.tma-portal-viewer__panel-body');
  check(/sent this file for signature/.test(activity), 'the timeline records the send in words');

  step(8, 'A non-signable file is not offered signing');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
  await openLibrary();
  const txtRow = page.locator('tr[data-type="file"]:visible', { hasText: '.txt' }).first();
  if (await txtRow.count()) {
    await txtRow.dblclick();
    await page.waitForSelector('.tma-portal-viewer', { timeout: 8000 });
    await page.waitForTimeout(1200);
    await page.click('[data-lb-act="approvals"]');
    await page.waitForTimeout(1800);
    check(!(await page.$('[data-lb-send-signature]')), 'a .txt file is not offered signing');
  } else {
    log('    – no .txt file present to check; skipped');
  }
} catch (e) {
  failures.push('threw: ' + e.message);
  await page.screenshot({ path: 'tests/Browser/file-signatures-error.png', fullPage: true }).catch(() => {});
} finally {
  if (!failures.length) await page.screenshot({ path: 'tests/Browser/file-signatures.png' }).catch(() => {});
  await browser.close();
  log('\n' + '='.repeat(52));
  if (errors.length) log('JS errors:\n  ' + errors.join('\n  '));
  if (failures.length) { log(`FAILED (${failures.length}):\n  ` + failures.join('\n  ')); process.exit(1); }
  log('Phase 5 signature checks passed.');
}
