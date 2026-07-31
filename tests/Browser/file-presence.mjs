import { chromium } from 'playwright';

/**
 * Phase 6 — active viewers.
 *
 * A single session can never demonstrate presence, so this runs two browser
 * contexts on the same file and checks that each sees the other's face appear
 * and then disappear when they leave. §13's rule — presence is a heartbeat,
 * never an inference from past activity — is what the disappearance proves.
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

async function openVia(page, navId, name) {
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await page.click('[data-expand="folders"]');
  await page.waitForTimeout(400);
  await page.click(`[data-nav="${navId}"]`);
  await page.waitForTimeout(1800);
  await page.locator('tr[data-type="file"]:visible', { hasText: name }).first().dblclick();
  await page.waitForSelector('.tma-portal-viewer', { timeout: 8000 });
  await page.waitForTimeout(1500);
}

const stamp = Date.now();
const NAME = `Presence ${stamp}.txt`;

const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

let other;
try {
  step(1, 'Create a file both accounts can open');
  await signIn(page, 'e2e@example.com');
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);

  const setup = await page.evaluate(async ([base, name]) => {
    const csrf = decodeURIComponent((document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/) || [])[1] || '');
    const h = { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'X-XSRF-TOKEN': csrf };
    const form = new FormData();
    form.append('file', new File(['presence probe'], name, { type: 'text/plain' }));
    const created = await fetch(base + '/portal/files/files', {
      method: 'POST', credentials: 'same-origin', headers: h, body: form,
    }).then((r) => r.json());
    const shared = await fetch(base + '/portal/files/shares', {
      method: 'POST', credentials: 'same-origin',
      headers: { ...h, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'file', id: created.id, mode: 'invite', email: 'bea@example.com', role: 'editor' }),
    });
    return { id: created.id, shareStatus: shared.status };
  }, [BASE, NAME]);
  check(setup.shareStatus === 201, `shared with the second account (HTTP ${setup.shareStatus})`);

  step(2, 'Opening the file puts you on its roster');
  await openVia(page, 'folders-all', NAME);
  const solo = await page.evaluate(async ([base, id]) => {
    const r = await fetch(`${base}/portal/files/files/${id}/presence`, {
      credentials: 'same-origin', headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    }).then((res) => res.json());
    return r.total;
  }, [BASE, setup.id]);
  check(solo === 1, `one active viewer — you (got ${solo})`);

  step(3, 'A second person opening it appears as a face, live');
  other = await browser.newContext();
  const page2 = await other.newPage({ viewport: { width: 1440, height: 900 } });
  await signIn(page2, 'bea@example.com');
  await openVia(page2, 'folders-sharedwithme', NAME);

  // The first browser should learn about it without reloading.
  await page.evaluate(() => { window.__tmaSentinel = 'alive'; });
  let faces = 0;
  for (let i = 0; i < 24 && faces < 2; i++) {
    await page.waitForTimeout(500);
    faces = await page.$$eval('.tma-portal-viewer__presence img', (n) => n.length).catch(() => 0);
  }
  check(faces >= 2, `the other person's face appeared (${faces} faces)`);
  check(await page.evaluate(() => window.__tmaSentinel === 'alive'),
    'it arrived without reloading the page');

  step(4, 'Hovering a face reveals who it is');
  const titles = await page.$$eval('.tma-portal-viewer__presence img', (n) => n.map((x) => x.getAttribute('title')));
  check(titles.some((t) => /Ben Staff/.test(t || '')), `a face names the person (${JSON.stringify(titles)})`);
  check(titles.some((t) => /@/.test(t || '')), 'and shows their email');
  check(titles.some((t) => /Currently viewing/.test(t || '')), 'and what they are doing');

  step(5, 'Clicking the stack opens the full list');
  await page.click('[data-lb-presence-open]');
  await page.waitForTimeout(700);
  const list = await page.textContent('.tma-portal-modal').catch(() => '');
  check(/Ben Staff/.test(list), 'the list names the other person');
  check(/\(you\)/.test(list), 'and marks which one is you');
  await page.click('.tma-portal-modal__close, [data-modal-close]').catch(async () => {
    await page.keyboard.press('Escape');
  });
  await page.waitForTimeout(600);

  step(6, 'Typing a comment reports as "Commenting", not merely viewing');
  await page2.click('[data-lb-act="comments"]');
  await page2.waitForTimeout(1200);
  await page2.fill('[data-lb-input]', 'thinking out loud');
  // Wait for the next heartbeat to carry the changed action.
  let action = '';
  for (let i = 0; i < 30 && !/Commenting/.test(action); i++) {
    await page.waitForTimeout(1000);
    const t = await page.$$eval('.tma-portal-viewer__presence img', (n) => n.map((x) => x.getAttribute('title')).join('|'));
    action = t;
  }
  check(/Commenting/.test(action), `the action updated to Commenting (${action})`);

  step(7, 'Closing the viewer removes them at once, not after a timeout');
  await page2.keyboard.press('Escape');
  await page2.waitForTimeout(500);

  let remaining = 99;
  for (let i = 0; i < 20 && remaining > 1; i++) {
    await page.waitForTimeout(500);
    remaining = await page.$$eval('.tma-portal-viewer__presence img', (n) => n.length).catch(() => 0);
  }
  check(remaining === 1, `only you remain (${remaining} faces)`);

  step(8, 'Presence never claims someone is here from past activity');
  // Ben has commented and viewed this file — history that must NOT put him
  // back on the roster now that his tab is closed.
  const after = await page.evaluate(async ([base, id]) => {
    const r = await fetch(`${base}/portal/files/files/${id}/presence`, {
      credentials: 'same-origin', headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    }).then((res) => res.json());
    return { total: r.total, names: (r.all || []).map((p) => p.name) };
  }, [BASE, setup.id]);
  check(after.total === 1 && !after.names.includes('Ben Staff'),
    `history does not resurrect a viewer (${JSON.stringify(after.names)})`);
} catch (e) {
  failures.push('threw: ' + e.message);
  await page.screenshot({ path: 'tests/Browser/file-presence-error.png', fullPage: true }).catch(() => {});
} finally {
  if (!failures.length) await page.screenshot({ path: 'tests/Browser/file-presence.png' }).catch(() => {});
  if (other) await other.close().catch(() => {});
  await browser.close();
  log('\n' + '='.repeat(52));
  if (errors.length) log('JS errors:\n  ' + errors.join('\n  '));
  if (failures.length) { log(`FAILED (${failures.length}):\n  ` + failures.join('\n  ')); process.exit(1); }
  log('Phase 6 presence checks passed.');
}
