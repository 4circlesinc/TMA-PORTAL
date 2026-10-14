import { chromium } from 'playwright';
import { readFileSync } from 'fs';

// Templates > Welcome Message, end to end.
//
// An administrator writes the welcome, picks who it comes from and switches
// it on; the preview is the Messages bubble itself. A pending account is then
// approved, and the new person signs in to find the message in their
// Messages inbox, unread, from the chosen administrator. The sender's inbox
// holds the same conversation.
//
// Also pins: moving between Templates panes by the sidebar draws the pane
// clicked (the address bar still shows the old page while the view mounts),
// the page fits a phone with no sideways scroll, the Messages inbox column
// keeps its bar at the bottom, and an officer never sees the row.
//
// Seed and server: see README, "welcome-message.mjs".
const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8897';
const ADMIN = process.env.TMA_EMAIL || 'e2e@example.com';            // Vernon Francis
const NEWBIE = process.env.TMA_EMAIL_NEW || 'newbie@example.com';    // Dana Reed, pending
const OFFICER = process.env.TMA_EMAIL_OFFICER || 'officer@example.com';
const LOG = process.env.TMA_LOG || 'storage/logs/laravel.log';
const SHOTS = process.env.TMA_SHOTS || 'tests/Browser';

function loginCode() {
  const hits = [...readFileSync(LOG, 'utf8').matchAll(/letter-spacing:\.24em[^>]*>(\d{6})</g)];
  return hits.length ? hits[hits.length - 1][1] : null;
}

const log = (...a) => console.log(...a);
const failures = [];
function step(n, msg) { log(`\n[${n}] ${msg}`); }
function check(ok, msg) {
  log(`    ${ok ? '✓' : '✗'} ${msg}`);
  if (!ok) failures.push(msg);
}

const browser = await chromium.launch();

async function session(email, viewport = { width: 1280, height: 900 }) {
  const context = await browser.newContext({ viewport });
  await context.addInitScript(() => { try { localStorage.setItem('tma.legalAccepted', '1'); } catch (e) {} });
  const page = await context.newPage();
  page.on('pageerror', (e) => failures.push(`page error for ${email}: ${e.message}`));

  await page.goto(`${BASE}/auth/login`, { waitUntil: 'networkidle' });
  await page.click('text=Sign in with Email');
  await page.waitForSelector('input[name="email"]', { state: 'visible', timeout: 8000 });
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', 'password12345');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}),
    page.click('button[type="submit"]:visible'),
  ]);
  if (page.url().includes('/auth/login-code')) {
    await page.waitForTimeout(900);
    const code = loginCode();
    if (!code) throw new Error(`no sign-in code in ${LOG}`);
    await page.locator('.tma-auth__otp-digit').first().click();
    await page.keyboard.type(code, { delay: 40 });
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}),
      page.click('button[type="submit"]:visible'),
    ]);
  }
  const stay = page.locator('form:has(input[name="stay"][value="yes"]) button[type="submit"]');
  if (await stay.count()) {
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}),
      stay.first().click(),
    ]);
  }
  if (page.url().includes('/auth/login')) throw new Error('login failed for ' + email);
  return page;
}

async function eventually(page, ms, probe) {
  for (let waited = 0; waited < ms; waited += 200) {
    if (await probe()) return true;
    await page.waitForTimeout(200);
  }
  return false;
}

/* Hover the rail open, open Templates if the row is still folded, click it,
   then move the pointer off so the overlay closes. A click on Templates
   while the rail is icon-only goes to the section's first page instead of
   unfolding the list, so the pointer has to be on the rail first. */
async function clickNav(page, navId) {
  const sidebar = page.locator('.tma-dash__sidebar');
  const box = await sidebar.boundingBox();
  if (box) await page.mouse.move(box.x + Math.min(40, box.width / 2), box.y + 120);
  await page.waitForTimeout(300);
  const subnav = page.locator('.tma-dash__sidebar [data-expand="templates"]');
  const item = page.locator(`.tma-dash__sidebar .tma-dash__nav-item[data-nav="${navId}"]`);
  if (!(await item.isVisible())) {
    await subnav.click();
    await page.waitForTimeout(400);
  }
  await item.click();
  await page.mouse.move(1000, 700);
  await page.waitForTimeout(700);
}

/* An API call from inside the page, with its session and XSRF token. */
async function api(page, method, path, body) {
  return page.evaluate(async ({ method, path, body }) => {
    const token = decodeURIComponent((document.cookie.match(/XSRF-TOKEN=([^;]+)/) || [])[1] || '');
    const r = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'X-XSRF-TOKEN': token },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, json: await r.json().catch(() => null) };
  }, { method, path, body });
}

const form = (page) => page.locator('[data-view="templates"]:not([hidden]) [data-wtpl-body]');
const previewBubble = (page) => page.locator('[data-wtpl-preview] .tma-dash__messages-bubble--in');

let admin;
try {
  step(1, 'The admin opens Templates > Welcome Message from the sidebar');
  admin = await session(ADMIN);
  await admin.goto(`${BASE}/templates`, { waitUntil: 'networkidle' });
  await admin.mouse.move(1000, 700);
  await admin.waitForTimeout(800);
  check(await admin.locator('.tma-dash__nav-item[data-nav="templates-welcome"]').count() === 1, 'the sidebar has one Welcome Message row');
  await clickNav(admin, 'templates-welcome');
  check(await eventually(admin, 6000, async () => (await form(admin).count()) === 1), 'the welcome editor is drawn');
  check(new URL(admin.url()).pathname === '/templates/welcome', 'the address is /templates/welcome');
  const draft = await form(admin).inputValue();
  check(draft.startsWith('Hi{{#firstName}} {{firstName}}{{/firstName}},'), 'the shipped message is offered');
  const welcomeSwitch = admin.locator('.tma-dash__view[data-view="templates"]:not([hidden]) [data-wtpl-enabled]');
  check(!(await welcomeSwitch.isChecked()), 'it starts switched off');
  check(await admin.locator('[data-wtpl-token]').count() === 4, 'four placeholder chips');
  const from = await admin.locator('[data-wtpl-sender] option:checked').textContent();
  check(/Vernon Francis/.test(from || ''), `the admin writing it is offered as the sender (${from})`);

  step(2, 'The preview is a Messages bubble, filled for a sample new person');
  check(await eventually(admin, 6000, async () => (await previewBubble(admin).count()) === 1), 'one incoming bubble in the preview');
  const previewText = await previewBubble(admin).innerText();
  check(/^Hi Ada,/.test(previewText), `it greets the sample person (${previewText.slice(0, 30)}…)`);
  check(/I'm Vernon Francis, IT and Web Solutions Specialist at TM Antoine Partners\./.test(previewText), 'the sender\'s name and job title are filled in');
  check(!/\{\{/.test(previewText), 'no placeholder is left in the preview');
  // A blank line is a paragraph gap in a message, the same as in the inbox.
  const lines = await previewBubble(admin).locator('br, .tma-dash__messages-copy-gap').count();
  check(lines >= 3, `the paragraphs keep their line breaks (${lines} breaks)`);
  const avatar = await admin.locator('[data-wtpl-preview] .tma-dash__messages-bubble-avatar').count();
  check(avatar === 1, 'the sender\'s face sits beside the bubble');
  await admin.screenshot({ path: `${SHOTS}/welcome-message-editor.png`, fullPage: false });

  step(3, 'Bold typed with Ctrl+B and a placeholder chip show in the preview');
  await form(admin).click();
  // Place the caret at the end. Control+End does not move a textarea caret
  // in Chromium on macOS, so the shortcut and the chip would land at the start.
  await form(admin).evaluate((el) => el.setSelectionRange(el.value.length, el.value.length));
  await admin.keyboard.press('Enter');
  await admin.keyboard.press('Control+b');
  await admin.keyboard.type('See you inside');
  await admin.locator('[data-wtpl-token="name"]').dispatchEvent('mousedown');
  check(/\*See you inside\{\{name\}\}\*$/.test(await form(admin).inputValue()), 'Ctrl+B typed the marks and the chip landed at the caret');
  check(await eventually(admin, 4000, async () => (await previewBubble(admin).locator('strong', { hasText: 'See you insideAda Lovelace' }).count()) === 1),
    'the preview draws it bold with the name filled in');
  await admin.locator('[data-wtpl-restore]').click();
  check((await form(admin).inputValue()).startsWith('Hi{{#firstName}}'), 'Restore default puts the shipped message back');

  step(4, 'Switch it on and save; it survives a reload');
  await admin.locator('.tma-dash__view[data-view="templates"]:not([hidden]) label:has([data-wtpl-enabled])').click();
  check(await welcomeSwitch.isChecked(), 'the switch is on');
  await admin.locator('[data-wtpl-save]').click();
  check(await eventually(admin, 5000, async () => (await admin.locator('text=Welcome message saved').count()) > 0), 'the toast says it saved');
  await admin.reload({ waitUntil: 'networkidle' });
  await admin.mouse.move(1000, 700);
  check(await eventually(admin, 6000, async () => (await form(admin).count()) === 1), 'a hard refresh on /templates/welcome opens the editor');
  check(await welcomeSwitch.isChecked(), 'still switched on after a reload');
  check(/Last edited by Vernon Francis/.test(await admin.locator('.tma-dash__view[data-view="templates"]').innerText()), 'it says who last edited it');

  step(5, 'Moving between Templates panes draws the one clicked');
  await clickNav(admin, 'templates-email');
  check(await eventually(admin, 6000, async () => (await form(admin).count()) === 0), 'Email Templates replaces the welcome editor');
  await clickNav(admin, 'templates-system');
  check(await eventually(admin, 6000, async () => (await admin.locator('[data-tpl-search]').count()) === 1), 'System Emails draws its table');
  await clickNav(admin, 'templates-welcome');
  check(await eventually(admin, 6000, async () => (await form(admin).count()) === 1), 'and back to the welcome editor');

  step(6, 'Approving a pending account posts the welcome');
  const users = await api(admin, 'GET', '/admin/users');
  const pending = ((users.json && (users.json.users || users.json.data)) || []).find((u) => u.email === NEWBIE);
  check(!!pending, 'the pending account is listed');
  const approved = await api(admin, 'POST', `/admin/users/${pending && pending.id}/approve`, { account_type: 'CRO / Reviewing officer' });
  check(approved.status === 200, `approve answered ${approved.status} ${JSON.stringify(approved.json)}`);

  step(7, 'The new person finds it in their Messages inbox');
  const newbie = await session(NEWBIE);
  await newbie.goto(`${BASE}/social/messages`, { waitUntil: 'networkidle' });
  await newbie.mouse.move(900, 600);
  const row = newbie.locator('.tma-dash__messages-row:has(.tma-dash__messages-row-name-text:text-is("Vernon Francis"))').first();
  check(await eventually(newbie, 10000, async () => (await row.count()) === 1), 'a conversation with Vernon Francis is in the inbox');
  const rowText = await row.innerText();
  check(/Hi Dana/.test(rowText), `its preview is the welcome (${rowText.replace(/\s+/g, ' ').slice(0, 60)})`);
  const unread = row.locator('.tma-badge__label, .tma-dash__messages-unread');
  check((await unread.innerText().catch(() => '')).trim() === '1', 'it is marked unread (1)');
  await row.click();
  const got = newbie.locator('.tma-dash__messages-bubble-row--in', { hasText: 'Welcome to the TM Antoine Advisory Portal' }).last();
  check(await eventually(newbie, 8000, async () => (await got.count()) === 1), 'the bubble reads the welcome');
  check(/Hi Dana,/.test(await got.innerText()), 'addressed to Dana by first name');

  // The inbox column must still be a flex column with its bar at the bottom.
  const column = await newbie.evaluate(() => {
    const cols = document.querySelectorAll('.tma-dash__messages-list');
    const col = cols[0];
    if (!col) return null;
    const foot = col.querySelector('.tma-dash__messages-list-foot');
    const c = col.getBoundingClientRect();
    const f = foot ? foot.getBoundingClientRect() : null;
    return { count: cols.length, display: getComputedStyle(col).display, gap: f ? Math.round(c.bottom - f.bottom) : null };
  });
  check(column && column.count === 1 && column.display === 'flex', `one inbox column, still flex (${JSON.stringify(column)})`);
  check(column && column.gap !== null && Math.abs(column.gap) <= 2, 'its bar sits at the bottom of the column');
  await newbie.screenshot({ path: `${SHOTS}/welcome-message-inbox.png`, fullPage: false });

  step(8, 'The sender\'s inbox holds the same conversation');
  await admin.goto(`${BASE}/social/messages`, { waitUntil: 'networkidle' });
  await admin.mouse.move(900, 600);
  const sent = admin.locator('.tma-dash__messages-row:has(.tma-dash__messages-row-name-text:text-is("Dana Reed"))').first();
  check(await eventually(admin, 10000, async () => (await sent.count()) === 1), 'Vernon\'s inbox has the conversation with Dana Reed');

  step(9, 'On a phone the editor fits with no sideways scroll');
  const phone = await session(ADMIN, { width: 390, height: 844 });
  await phone.goto(`${BASE}/templates/welcome`, { waitUntil: 'networkidle' });
  check(await eventually(phone, 6000, async () => (await form(phone).count()) === 1), 'the editor opens at phone width');
  const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(overflow <= 0, `no horizontal scroll (${overflow}px)`);
  await phone.screenshot({ path: `${SHOTS}/welcome-message-phone.png`, fullPage: true });

  step(10, 'An officer never sees the row');
  const officer = await session(OFFICER);
  await officer.goto(`${BASE}/templates/email`, { waitUntil: 'networkidle' });
  await officer.waitForTimeout(800);
  check(await officer.locator('.tma-dash__nav-item[data-nav="templates-welcome"]').count() === 0, 'no Welcome Message row for an officer');
  const refused = await api(officer, 'GET', '/portal/templates/welcome-message');
  check(refused.status === 403, `its API refuses an officer (${refused.status})`);
} catch (e) {
  failures.push('crashed: ' + e.message);
  log(e.stack);
  if (admin) await admin.screenshot({ path: `${SHOTS}/welcome-message-crash.png` }).catch(() => {});
}

await browser.close();
log(failures.length ? `\n${failures.length} failure(s):\n - ${failures.join('\n - ')}` : '\nAll checks passed.');
process.exit(failures.length ? 1 : 0);
