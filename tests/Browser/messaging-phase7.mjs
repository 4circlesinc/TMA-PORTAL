import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Phase 7: group conversations and the firm-wide organization chat.
//
// The rules that matter are about *ownership*: a group is run by its admins,
// but the organization chat belongs to the firm — administrator-only to change,
// impossible to leave, and its membership follows the staff list rather than
// being curated. Every change leaves a system message so the group can see its
// own history.
//
// See README.md for setup. Needs the messaging seed, and an administrator
// account (the seeded e2e@example.com is one).
const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8899';
const EMAIL = process.env.TMA_EMAIL || 'e2e@example.com';
const MEMBER = process.env.TMA_EMAIL_B || 'user0@example.com'; // Ana Ruiz

const log = (...a) => console.log(...a);
const failures = [];
const errors = [];

function step(n, msg) { log(`\n[${n}] ${msg}`); }
function check(ok, msg) {
  log(`    ${ok ? '✓' : '✗'} ${msg}`);
  if (!ok) failures.push(msg);
}

const browser = await chromium.launch();

async function session(email, track) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await context.newPage();
  if (track) {
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => {
      if (m.type() === 'error' && !/403|404|422|favicon/.test(m.text())) errors.push('console: ' + m.text());
    });
  }
  await page.goto(`${BASE}/auth/login`, { waitUntil: 'networkidle' });
  await page.click('text=Sign in with Email');
  await page.waitForSelector('input[name="email"]', { state: 'visible', timeout: 8000 });
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', 'password12345');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}),
    page.click('button[type="submit"]:visible'),
  ]);
  await page.goto(`${BASE}/social/messages`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.tma-dash__messages-row', { timeout: 15000 });
  await page.waitForTimeout(1500);
  return page;
}

let admin;
try {
  step(1, 'Sign in');
  admin = await session(EMAIL, true);
  check(true, `signed in as ${EMAIL}`);

  step(2, 'The organization chat is present and pinned');
  const org = await admin.evaluate(async (base) => {
    const r = await fetch(base + '/portal/messaging/conversations', {
      headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      credentials: 'same-origin',
    }).then((res) => res.json());
    const chat = r.conversations.find((c) => c.isDefault);
    return chat ? {
      name: chat.name, pinned: chat.pinned, canManage: chat.canManage,
      canLeave: chat.canLeave, members: chat.memberCount, index: r.conversations.indexOf(chat),
    } : null;
  }, BASE);

  check(!!org, 'the organization chat exists');
  check(org?.name === 'TM Antoine Advisory and Partners', `named "${org?.name}"`);
  check(org?.pinned === true, 'it is pinned by default');
  check(org?.index === 0, 'so it sits at the top of the list');
  // Membership grows as accounts open Messages, so it is asserted in step 12
  // once a second account has been through the auto-join path.
  check(org?.members >= 1, `this account is already a member (${org?.members})`);

  step(3, 'An administrator may manage it, but nobody may leave it');
  check(org?.canManage === true, 'this administrator can manage it');
  check(org?.canLeave === false, 'and cannot leave it');

  const leaveRefused = await admin.evaluate(async (base) => {
    const list = await fetch(base + '/portal/messaging/conversations', {
      headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      credentials: 'same-origin',
    }).then((r) => r.json());
    const chat = list.conversations.find((c) => c.isDefault);
    const csrf = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);
    const res = await fetch(base + '/portal/messaging/conversations/' + chat.id, {
      method: 'DELETE',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest',
        'X-XSRF-TOKEN': csrf ? decodeURIComponent(csrf[1]) : '',
      },
    });
    return res.status;
  }, BASE);
  check(leaveRefused === 422, `the server refuses to let anyone leave it (${leaveRefused})`);

  step(4, 'Creating a group from the composer');
  await admin.click('[data-messages-compose]');
  await admin.waitForTimeout(1200);
  check(await admin.locator('[data-messages-new-group]').count() === 1, 'a "New group" action is offered');

  await admin.click('[data-messages-new-group]');
  await admin.waitForTimeout(1500);
  check(await admin.locator('[data-messages-group-name]').count() === 1, 'the group panel opened');

  const createBtn = admin.locator('[data-messages-group-create]');
  check(await createBtn.isDisabled(), 'creating is disabled until it has a name and people');

  const groupName = 'Falcon ' + Date.now().toString().slice(-5);
  await admin.fill('[data-messages-group-name]', groupName);
  await admin.locator('[data-messages-group-pick]').first().click();
  await admin.waitForTimeout(500);
  await admin.locator('[data-messages-group-pick]').nth(1).click();
  await admin.waitForTimeout(500);

  check(await admin.locator('.tma-dash__messages-chip').count() === 2, 'chosen people show as chips');
  check(!(await createBtn.isDisabled()), 'creating is now enabled');

  await createBtn.click();
  await admin.waitForTimeout(3000);

  const header = await admin.textContent('.tma-dash__messages-chat-head');
  check(header.includes(groupName), `the group opened ("${groupName}")`);

  step(5, 'The group records its own creation');
  const chatText = await admin.textContent('[data-messages-chat-body]');
  check(/created the group/i.test(chatText), 'a "created the group" system message is shown');

  step(6, 'Group messages name their sender');
  await admin.click('[data-messages-composer-input]');
  await admin.keyboard.type('first group message');
  await admin.click('[data-messages-composer-send]');
  await admin.waitForTimeout(1800);
  check(
    (await admin.textContent('[data-messages-chat-body]')).includes('first group message'),
    'a message sends in the new group',
  );

  step(7, 'The profile lists members and offers admin controls');
  await admin.click('[data-messages-open-profile]');
  await admin.waitForTimeout(2200);

  const members = await admin.locator('.tma-dash__messages-member').count();
  check(members === 3, `all three members are listed (${members})`);
  check(await admin.locator('[data-messages-group-add]').count() === 1, 'the creator can add people');
  check(await admin.locator('[data-messages-group-rename]').count() === 1, 'and rename it');
  check(await admin.locator('[data-messages-group-photo]').count() === 1, 'and change the photo');
  check(await admin.locator('[data-messages-group-leave]').count() === 1, 'and leave it');

  const profileText = await admin.textContent('.tma-dash__messages-chat--profile');
  check(/Administrator/.test(profileText), 'the creator is shown as an administrator');

  step(8, 'Promoting a member is recorded');
  await admin.locator('[data-messages-member-role]').first().click();
  await admin.waitForTimeout(2500);

  const admins = await admin.evaluate(() =>
    [...document.querySelectorAll('.tma-dash__messages-person-meta')]
      .filter((el) => el.textContent.trim() === 'Administrator').length
  );
  check(admins === 2, `there are now two administrators (${admins})`);

  await admin.click('[data-messages-profile-back]');
  await admin.waitForTimeout(1500);
  check(
    /made .* an administrator/i.test(await admin.textContent('[data-messages-chat-body]')),
    'the promotion appears as a system message',
  );

  step(9, 'Renaming the group is recorded');
  const renamed = groupName + ' Squad';
  await admin.click('[data-messages-open-profile]');
  await admin.waitForTimeout(2000);
  admin.once('dialog', (d) => d.accept(renamed));
  await admin.click('[data-messages-group-rename]');
  await admin.waitForTimeout(2500);

  await admin.click('[data-messages-profile-back]');
  await admin.waitForTimeout(1500);
  const afterRename = await admin.textContent('.tma-dash__messages-chat-head');
  check(afterRename.includes(renamed), `the header shows the new name ("${renamed}")`);
  check(
    /changed the group name/i.test(await admin.textContent('[data-messages-chat-body]')),
    'the rename appears as a system message',
  );

  step(10, 'Removing a member is recorded');
  await admin.click('[data-messages-open-profile]');
  await admin.waitForTimeout(2000);
  admin.once('dialog', (d) => d.accept());
  await admin.locator('[data-messages-member-remove]').last().click();
  await admin.waitForTimeout(2500);

  const remaining = await admin.locator('.tma-dash__messages-member').count();
  check(remaining === 2, `the group is down to two members (${remaining})`);

  await admin.click('[data-messages-profile-back]');
  await admin.waitForTimeout(1500);
  check(
    /removed/i.test(await admin.textContent('[data-messages-chat-body]')),
    'the removal appears as a system message',
  );

  step(11, 'A plain member cannot manage the organization chat');
  const member = await session(MEMBER, false);
  const memberView = await member.evaluate(async (base) => {
    const r = await fetch(base + '/portal/messaging/conversations', {
      headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      credentials: 'same-origin',
    }).then((res) => res.json());
    const chat = r.conversations.find((c) => c.isDefault);
    return chat ? { canManage: chat.canManage, canLeave: chat.canLeave, id: chat.id } : null;
  }, BASE);

  check(memberView?.canManage === false, 'a non-administrator cannot manage it');
  check(memberView?.canLeave === false, 'and cannot leave it either');

  const renameRefused = await member.evaluate(async ([base, id]) => {
    const csrf = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);
    const res = await fetch(base + '/portal/messaging/groups/' + id, {
      method: 'PATCH',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json', Accept: 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        'X-XSRF-TOKEN': csrf ? decodeURIComponent(csrf[1]) : '',
      },
      body: JSON.stringify({ name: 'Hijacked' }),
    });
    return res.status;
  }, [BASE, memberView.id]);
  check(renameRefused === 403, `the server refuses their rename (${renameRefused})`);

  step(12, 'Members auto-join without anything being re-run');
  const joined = await member.evaluate(async (base) => {
    const r = await fetch(base + '/portal/messaging/conversations', {
      headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      credentials: 'same-origin',
    }).then((res) => res.json());
    return !!r.conversations.find((c) => c.isDefault);
  }, BASE);
  check(joined, 'the second account is a member simply by opening Messages');

  // Now that two accounts have opened Messages, the chat should hold both —
  // without the seeding command being re-run.
  const grown = await admin.evaluate(async (base) => {
    const r = await fetch(base + '/portal/messaging/conversations', {
      headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      credentials: 'same-origin',
    }).then((res) => res.json());
    return r.conversations.find((c) => c.isDefault)?.memberCount;
  }, BASE);
  check(grown >= 2, `membership grew to ${grown} without re-seeding`);

  await admin.screenshot({ path: join(HERE, 'messaging-phase7.png') });
  log('\nwrote messaging-phase7.png');
} catch (err) {
  failures.push('threw: ' + err.message);
  log('\nERROR: ' + err.message);
} finally {
  await browser.close();
}

if (errors.length) {
  log('\nPage errors:');
  errors.forEach((e) => log('  ' + e));
}

log('\n' + (failures.length ? `FAILED (${failures.length})` : 'ALL CHECKS PASSED'));
failures.forEach((f) => log('  ✗ ' + f));
process.exit(failures.length ? 1 : 0);
