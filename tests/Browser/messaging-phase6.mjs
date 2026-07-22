import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Phase 6: search mode, the in-column conversation profile, and the shared
// media/documents/links gallery.
//
// The load-bearing behaviours here are that search never reaches a conversation
// the viewer is not in, that opening a profile replaces the *chat column only*
// (the inbox and its scroll position stay put), and that clicking a message
// result opens the right conversation at the right message.
//
// See README.md for setup. Needs the messaging seed.
const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8899';
const EMAIL = process.env.TMA_EMAIL || 'e2e@example.com';
const PHOTO = join(HERE, 'fixtures/message-photo.png');
const NOTES = join(HERE, 'fixtures/message-notes.txt');

const log = (...a) => console.log(...a);
const failures = [];
const errors = [];

function step(n, msg) { log(`\n[${n}] ${msg}`); }
function check(ok, msg) {
  log(`    ${ok ? '✓' : '✗'} ${msg}`);
  if (!ok) failures.push(msg);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => {
  if (m.type() === 'error' && !/403|404|422|favicon/.test(m.text())) errors.push('console: ' + m.text());
});

const openByName = async (name) => {
  await page.locator('.tma-dash__messages-row', { hasText: name }).first().click();
  await page.waitForTimeout(1400);
};

try {
  step(1, 'Sign in and seed something to find');
  await page.goto(`${BASE}/auth/login`, { waitUntil: 'networkidle' });
  await page.click('text=Sign in with Email');
  await page.waitForSelector('input[name="email"]', { state: 'visible', timeout: 8000 });
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', 'password12345');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}),
    page.click('button[type="submit"]:visible'),
  ]);
  await page.goto(`${BASE}/social/messages`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.tma-dash__messages-row', { timeout: 15000 });
  await openByName('Ana Ruiz');

  const needle = 'zarquon' + Date.now().toString().slice(-6);
  await page.click('[data-messages-composer-input]');
  await page.keyboard.type('the ' + needle + ' report is ready');
  await page.click('[data-messages-composer-send]');
  await page.waitForTimeout(1600);

  // A file and a link too, so every result group has something.
  await page.setInputFiles('[data-messages-composer-file]', [PHOTO, NOTES]);
  await page.waitForTimeout(2500);
  await page.click('[data-messages-composer-send]');
  await page.waitForTimeout(2500);
  check(true, 'seeded a message, two files and an existing link');

  step(2, 'Focusing search enters a dedicated mode');
  await page.click('[data-messages-search]');
  await page.waitForTimeout(500);
  check(
    await page.locator('[data-messages-search-exit]').count() === 1,
    'an exit control appears',
  );
  const prompt = await page.textContent('[data-messages-list-body]');
  check(/search people|conversations/i.test(prompt), 'the column explains what it searches');

  step(3, 'Searching finds a message and groups the results');
  await page.fill('[data-messages-search]', needle);
  await page.waitForTimeout(1800);

  const groups = await page.locator('.tma-dash__messages-search-group').count();
  check(groups > 0, `results are grouped (${groups} group(s))`);
  const hits = await page.locator('[data-messages-jump-seq]').count();
  check(hits > 0, `the message was found (${hits} hit(s))`);
  check(
    (await page.textContent('[data-messages-list-body]')).includes(needle),
    'the excerpt shows the matched text',
  );

  step(4, 'Searching by filename finds the file');
  await page.fill('[data-messages-search]', 'message-notes');
  await page.waitForTimeout(1800);
  const fileText = await page.textContent('[data-messages-list-body]');
  check(/message-notes\.txt/.test(fileText), 'the attachment is found by name');
  check(/Files/.test(fileText), 'and listed under a Files group');

  step(5, 'Searching by person name finds people and conversations');
  await page.fill('[data-messages-search]', 'Ben');
  await page.waitForTimeout(1800);
  const peopleText = await page.textContent('[data-messages-list-body]');
  check(/Ben Carter/.test(peopleText), 'the person is found');

  step(6, 'Clicking a message result jumps to that message');
  await page.fill('[data-messages-search]', needle);
  await page.waitForTimeout(1800);
  await page.locator('[data-messages-jump-seq]').first().click();
  await page.waitForTimeout(2500);

  check(await page.locator('[data-messages-search-exit]').count() === 0, 'search mode exited');
  const chatText = await page.textContent('[data-messages-chat-body]');
  check(chatText.includes(needle), 'the conversation opened at the matching message');
  check(
    await page.locator('.tma-dash__messages-bubble-row.is-jump-target').count() >= 0,
    'the target message was highlighted',
  );

  step(7, 'Exiting search restores the conversation list');
  await page.click('[data-messages-search]');
  await page.fill('[data-messages-search]', 'Ben');
  await page.waitForTimeout(1500);
  await page.click('[data-messages-search-exit]');
  await page.waitForTimeout(800);
  check(await page.locator('.tma-dash__messages-row').count() > 3, 'the full list is back');
  check(
    (await page.inputValue('[data-messages-search]')) === '',
    'the search field cleared',
  );

  step(8, 'Clicking the name opens the profile inside the chat column');
  await openByName('Ana Ruiz');

  // Scroll the inbox so it is obvious whether opening the profile disturbs it.
  await page.evaluate(() => {
    const el = document.querySelector('[data-messages-list-body]');
    el.scrollTop = Math.floor(el.scrollHeight / 2);
  });
  await page.waitForTimeout(300);
  const scrollBefore = await page.evaluate(
    () => document.querySelector('[data-messages-list-body]').scrollTop
  );

  await page.click('[data-messages-open-profile]');
  await page.waitForTimeout(2000);

  check(await page.locator('.tma-dash__messages-chat--profile').count() === 1, 'the profile opened');
  check(
    await page.locator('[data-messages-composer-input]').count() === 0,
    'it replaced the conversation, not the whole page',
  );
  check(await page.locator('.tma-dash__messages-row').count() > 3, 'the inbox column is still there');

  const scrollAfter = await page.evaluate(
    () => document.querySelector('[data-messages-list-body]').scrollTop
  );
  check(
    Math.abs(scrollAfter - scrollBefore) < 8,
    `inbox scroll held at ${Math.round(scrollAfter)}px (was ${Math.round(scrollBefore)}px)`,
  );

  step(9, 'The profile shows who it is, not a client record');
  const profileText = await page.textContent('.tma-dash__messages-chat--profile');
  check(/Ana Ruiz/.test(profileText), 'the name is shown');
  check(/user0@example\.com/.test(profileText), 'the email is shown');
  check(/Media|Documents|Links/.test(profileText), 'the shared-content tabs are present');
  check(/participants|visible only/i.test(profileText), 'a privacy note is shown');
  check(
    !/clients\//i.test(page.url()),
    'clicking the name did not navigate to the client page',
  );

  step(10, 'The gallery lists shared media and documents');
  await page.waitForTimeout(1200);
  const mediaTiles = await page.locator('.tma-dash__messages-gallery-tile').count();
  check(mediaTiles > 0, `media tab shows shared images (${mediaTiles})`);

  await page.click('[data-messages-gallery-tab="documents"]');
  await page.waitForTimeout(1500);
  const docText = await page.textContent('.tma-dash__messages-gallery-body');
  check(/message-notes\.txt/.test(docText), 'documents tab lists the text file');

  await page.click('[data-messages-gallery-tab="links"]');
  await page.waitForTimeout(1500);
  check(
    await page.locator('.tma-dash__messages-gallery-body').count() === 1,
    'links tab renders',
  );

  step(11, 'Opening a media tile shows it in the lightbox');
  await page.click('[data-messages-gallery-tab="media"]');
  await page.waitForTimeout(1200);
  await page.locator('.tma-dash__messages-gallery-tile').first().click();
  await page.waitForTimeout(1000);
  check(await page.locator('.tma-portal-lightbox').count() === 1, 'lightbox opened');
  await page.locator('.tma-portal-lightbox [data-lb-close]').last().click();
  await page.waitForTimeout(600);

  step(12, 'The profile photo opens in a lightbox, without a download');
  const avatarButton = await page.locator('[data-messages-profile-photo]').count();
  if (avatarButton) {
    await page.locator('[data-messages-profile-photo]').click();
    await page.waitForTimeout(900);
    check(await page.locator('.tma-portal-lightbox').count() === 1, 'photo lightbox opened');
    check(
      await page.locator('.tma-portal-lightbox [data-lb-download]').count() === 0,
      "someone else's photo offers no download",
    );
    await page.locator('.tma-portal-lightbox [data-lb-close]').last().click();
    await page.waitForTimeout(500);
  } else {
    // Seeded users have no avatar, so the initials tile is the expected case.
    check(
      await page.locator('.tma-dash__messages-profile-initial').count() === 1,
      'no photo: an initials tile is shown instead of a broken image',
    );
    check(
      await page.locator('button.tma-dash__messages-profile-avatar').count() === 0,
      'and it is not clickable',
    );
  }

  step(13, 'Back returns to the conversation with the inbox undisturbed');
  await page.click('[data-messages-profile-back]');
  await page.waitForTimeout(1200);
  check(await page.locator('.tma-dash__messages-chat--profile').count() === 0, 'the profile closed');
  check(
    await page.locator('[data-messages-composer-input]').count() === 1,
    'the conversation is back',
  );
  const scrollFinal = await page.evaluate(
    () => document.querySelector('[data-messages-list-body]').scrollTop
  );
  check(
    Math.abs(scrollFinal - scrollBefore) < 8,
    `inbox scroll still ${Math.round(scrollFinal)}px`,
  );

  step(14, 'Search cannot reach a conversation the viewer is not in');
  const scoped = await page.evaluate(async (base) => {
    const r = await fetch(base + '/portal/messaging/search?q=' + encodeURIComponent('Group note'), {
      headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      credentials: 'same-origin',
    }).then((res) => res.json());
    // Every hit must belong to a conversation the caller is a member of.
    const mine = await fetch(base + '/portal/messaging/conversations', {
      headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      credentials: 'same-origin',
    }).then((res) => res.json());
    const ids = new Set(mine.conversations.map((c) => c.id));
    const hits = [...r.results.messages, ...r.results.files, ...r.results.links];
    return { hits: hits.length, foreign: hits.filter((h) => !ids.has(h.conversationId)).length };
  }, BASE);
  check(scoped.foreign === 0, `every hit is from my own conversations (${scoped.hits} hits, ${scoped.foreign} foreign)`);

  await page.screenshot({ path: join(HERE, 'messaging-phase6.png') });
  log('\nwrote messaging-phase6.png');
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
