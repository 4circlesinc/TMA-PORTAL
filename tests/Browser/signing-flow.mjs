// Drives the whole signing flow in a browser: owner sends, a recipient in a
// separate session opens the link, draws a signature, and finishes — then
// checks the used link is dead and the portal is unreachable from it.
// See README.md for setup.
import { chromium } from 'playwright';

const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8899';
const log = (...a) => console.log(...a);
const errors = [];

const browser = await chromium.launch();
const owner = await browser.newContext();
const page = await owner.newPage();

page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

const step = (n, m) => log(`\n[${n}] ${m}`);

try {
  // ── owner: log in, build and send a request ───────────
  step(1, 'Owner logs in and creates a request');
  await page.goto(`${BASE}/auth/login`, { waitUntil: 'networkidle' });
  await page.click('text=Sign in with Email');
  await page.waitForSelector('input[name="email"]', { state: 'visible' });
  await page.fill('input[name="email"]', 'e2e@example.com');
  await page.fill('input[name="password"]', 'password12345');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}),
    page.click('button[type="submit"]:visible'),
  ]);

  await page.goto(`${BASE}/signatures`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  await page.click('[data-sig-new-dropdown] [data-head-dropdown-toggle]');
  await page.waitForTimeout(200);
  await page.click('[data-sig-new-dropdown] [data-head-dropdown-item="send"]');
  await page.waitForTimeout(900);
  await (await page.$$('[data-sig-pick]'))[0].click();
  await page.click('[data-sig-new-create]');
  await page.waitForTimeout(900);

  await page.fill('[data-sig-r-name="0"]', 'Dana Reed');
  await page.fill('[data-sig-r-email="0"]', 'dana@example.com');
  await page.fill('[data-sig-wizard-subject]', 'Please sign the TMA contract');
  await page.fill('[data-sig-wizard-message]', 'Sign by Friday, thanks.');
  log('    recipient + subject/message filled');

  step(2, 'Placing a signature field and a date field, then sending');
  await page.click('[data-sig-wizard-next]');
  await page.waitForTimeout(3500);
  await page.click('[data-sig-field="signature"]');
  await page.waitForTimeout(250);
  await page.click('[data-sig-field="date"]');
  await page.waitForTimeout(250);
  log('    fields placed:', (await page.$$('[data-sig-placed]')).length);

  await page.click('[data-sig-wizard-next]');   // -> review
  await page.waitForTimeout(900);
  const sendLabel = await page.textContent('[data-sig-wizard-next]');
  log('    review button says:', JSON.stringify(sendLabel.trim()));

  await page.click('[data-sig-wizard-next]');   // -> send
  await page.waitForTimeout(1500);

  const listed = await page.evaluate(async () => {
    const r = await fetch('/portal/signatures', { headers: { Accept: 'application/json' } }).then((x) => x.json());
    return { status: r.requests[0].status, label: r.requests[0].statusLabel, id: r.requests[0].id };
  });
  log('    request status after send:', listed.status, '/', listed.label);
  if (listed.status !== 'sent') throw new Error('request did not reach "sent"');

  // ── owner: copy the signing link ──────────────────────
  step(3, 'Owner copies the signing link');
  const link = await page.evaluate(async (id) => {
    const r = await fetch('/portal/signatures/' + id + '/links', { headers: { Accept: 'application/json' } }).then((x) => x.json());
    return r.links[0];
  }, listed.id);
  log('    link for:', link.name, '| canSign:', link.canSign);
  if (!link.url) throw new Error('no signing link returned');

  // ── recipient: a completely separate browser session ──
  step(4, 'Recipient opens the link in a clean session (no portal account)');
  const guest = await browser.newContext();
  const sign = await guest.newPage();
  sign.on('pageerror', (e) => errors.push('signer pageerror: ' + e.message));
  sign.on('console', (m) => { if (m.type() === 'error') errors.push('signer console: ' + m.text()); });
  sign.on('response', async (r) => {
    if (/\/sign\/.*(progress|submit|decline)/.test(r.url()) && r.status() >= 400) {
      errors.push('API ' + r.status() + ': ' + (await r.text().catch(() => '')).slice(0, 160));
    }
  });

  await sign.goto(link.url, { waitUntil: 'networkidle' });
  await sign.waitForTimeout(3500);

  const bar = await sign.textContent('[data-progress]');
  log('    progress bar:', JSON.stringify(bar.trim()));

  const pages = await sign.$$('[data-canvas]');
  log('    document pages rendered:', pages.length);
  if (pages.length !== 2) throw new Error('signer did not get the real 2-page document');

  const painted = await sign.evaluate(() => {
    const c = document.querySelector('[data-canvas="0"]');
    const d = c.getContext('2d').getImageData(0, 0, c.width, Math.min(c.height, 400)).data;
    let ink = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] < 200) ink++;
    return { w: c.width, h: c.height, ink };
  });
  log('    page 1 canvas:', painted.w + 'x' + painted.h, '| ink pixels:', painted.ink);
  if (painted.ink < 50) throw new Error('signer sees a blank document');

  const fieldEls = await sign.$$('[data-field]');
  log('    fields shown to signer:', fieldEls.length);

  // The date field is autofilled — it should already be filled in.
  const prefilled = await sign.$$eval('[data-field]', (els) =>
    els.map((e) => ({ label: e.getAttribute('aria-label'), done: e.classList.contains('is-done') })));
  log('    field states:', JSON.stringify(prefilled));

  // ── recipient: draw a signature ───────────────────────
  step(5, 'Recipient draws a signature');
  const sigField = await sign.$('[data-field]');
  await sigField.click();
  await sign.waitForTimeout(400);

  const modal = await sign.$('.modal');
  log('    signature modal open:', !!modal);
  if (!modal) throw new Error('signature pad did not open');

  const tabs = await sign.$$eval('[data-mode]', (t) => t.map((x) => x.textContent.trim()));
  log('    capture modes:', tabs.join(', '));

  // Draw on the pad.
  const pad = await sign.$('[data-pad]');
  const box = await pad.boundingBox();
  await sign.mouse.move(box.x + 30, box.y + 90);
  await sign.mouse.down();
  await sign.mouse.move(box.x + 90, box.y + 40, { steps: 6 });
  await sign.mouse.move(box.x + 150, box.y + 120, { steps: 6 });
  await sign.mouse.move(box.x + 220, box.y + 60, { steps: 6 });
  await sign.mouse.up();
  await sign.waitForTimeout(300);
  await sign.screenshot({ path: new URL('./sign-pad.png', import.meta.url).pathname });

  await sign.click('[data-apply]');
  await sign.waitForTimeout(700);

  const filled = await sign.$$eval('[data-field]', (els) => els.filter((e) => e.classList.contains('is-done')).length);
  log('    fields now complete:', filled);
  const bar2 = await sign.textContent('[data-progress]');
  log('    progress bar:', JSON.stringify(bar2.trim()));

  await sign.screenshot({ path: new URL('./sign-page.png', import.meta.url).pathname });
  log('    SCREENSHOT: sign-page.png');

  // ── typed + upload modes still work ───────────────────
  step(6, 'Checking the typed signature mode renders');
  await sign.click('[data-field]');
  await sign.waitForTimeout(300);
  await sign.click('[data-mode="type"]');
  await sign.waitForTimeout(300);
  const typedVal = await sign.inputValue('[data-typed]');
  log('    typed mode prefills recipient name:', JSON.stringify(typedVal));
  await sign.click('[data-mode="upload"]');
  await sign.waitForTimeout(200);
  const hasFile = await sign.$('[data-file]');
  log('    upload mode has a file input:', !!hasFile);
  await sign.click('[data-close]');
  await sign.waitForTimeout(200);

  // ── submit ────────────────────────────────────────────
  step(7, 'Recipient finishes');
  const finishDisabled = await sign.getAttribute('[data-finish]', 'disabled');
  log('    finish enabled:', finishDisabled === null);
  if (finishDisabled !== null) throw new Error('finish still disabled with all required fields filled');

  await sign.click('[data-finish]');
  await sign.waitForTimeout(2000);

  const doneText = await sign.textContent('body');
  const isDone = /you're done|Thanks/i.test(doneText);
  const barGone = (await sign.$('[data-finish]')) === null;
  log('    signing toolbar removed:', barGone);
  log('    signer sees confirmation:', isDone);
  await sign.screenshot({ path: new URL('./sign-done.png', import.meta.url).pathname });
  if (!isDone) throw new Error('no confirmation after finishing');

  // The link must be dead now.
  step(8, 'Used link is dead; portal is unreachable from it');
  const reuse = await sign.goto(link.url, { waitUntil: 'networkidle' });
  log('    re-opening the used link:', reuse.status());
  if (reuse.status() !== 404) throw new Error('a used signing link still resolves');

  // goto() follows redirects, so the status alone would report the login
  // page's 200. What matters is where they landed and what a real XHR gets.
  await sign.goto(`${BASE}/signatures`, { waitUntil: 'networkidle' });
  const landedOn = new URL(sign.url()).pathname;
  log('    signer navigating to /signatures lands on:', landedOn);
  if (landedOn.startsWith('/signatures')) throw new Error('signer reached the portal page');

  const apiProbe = await sign.evaluate(async (base) => {
    const out = {};
    for (const p of ['/portal/signatures', '/portal/files/']) {
      const r = await fetch(base + p, { headers: { Accept: 'application/json' } });
      out[p] = r.status;
    }
    return out;
  }, BASE);
  log('    signer hitting portal APIs:', JSON.stringify(apiProbe));
  if (Object.values(apiProbe).some((s) => s === 200)) {
    throw new Error('signing session reached a portal API');
  }

  // ── owner sees the outcome ────────────────────────────
  step(9, 'Owner sees it completed, with an audit trail');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  const after = await page.evaluate(async (id) => {
    const r = await fetch('/portal/signatures/' + id, { headers: { Accept: 'application/json' } }).then((x) => x.json());
    return {
      status: r.request.status,
      progress: r.request.progress,
      events: r.request.events.map((e) => e.action),
      ips: r.request.events.filter((e) => e.ip).length,
    };
  }, listed.id);
  log('    status:', after.status, '| progress:', JSON.stringify(after.progress));
  log('    audit trail:', after.events.join(' → '));
  log('    events carrying an IP:', after.ips, 'of', after.events.length);
  if (after.status !== 'completed') throw new Error('request did not complete');
  if (!after.events.includes('signed') || !after.events.includes('viewed')) {
    throw new Error('audit trail is missing signing events');
  }

  log('\n=== RESULT: PASS ===');
} catch (err) {
  log('\n=== RESULT: FAIL ===');
  log(String(err.message));
  process.exitCode = 1;
} finally {
  if (errors.length) {
    log('\n--- browser errors ---');
    [...new Set(errors)].slice(0, 10).forEach((e) => log('  ' + e));
  } else {
    log('\n--- no browser console errors ---');
  }
  await browser.close();
}
