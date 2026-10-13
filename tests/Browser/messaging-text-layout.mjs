import { chromium } from 'playwright';
import { readFileSync } from 'fs';

// A message is laid out the way it was typed.
//
// Two faults made every multi-line message one paragraph. The bubble is an
// inline run, and HTML folds each line break in one into a space, so what was
// stored with its breaks was drawn without them. And the message box, which
// is contenteditable, was read with textContent, which reads straight through
// the <br> a typed Shift+Enter leaves: two typed lines were sent as one word.
// So only a browser can check this, at both ends: what the box sends, and
// what the bubble draws, for the person who wrote it and the one who reads it.
//
// It also pins the lists: lines that begin with a bullet or a number are set
// with the marker in its own column, the number shown is the number typed,
// bullets under a numbered line sit under it, and a one-line "- ok" is left
// as somebody talking.
//
// Two live sessions and Reverb, same setup and seed as messaging-realtime.mjs.
const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8899';
const USER_A = process.env.TMA_EMAIL || 'e2e@example.com';      // Test User
const USER_B = process.env.TMA_EMAIL_B || 'user0@example.com';  // Ana Ruiz
const GROUP = process.env.TMA_GROUP || 'TM Antoine Advisory and Partners';
/* Where MAIL_MAILER=log leaves the new-device code. */
const LOG = process.env.TMA_LOG || 'storage/logs/laravel.log';

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

async function session(email) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  // The sign-in page asks each new browser to agree to the legal terms first.
  await context.addInitScript(() => { try { localStorage.setItem('tma.legalAccepted', '1'); } catch (e) {} });
  const page = await context.newPage();

  await page.goto(`${BASE}/auth/login`, { waitUntil: 'networkidle' });
  await page.click('text=Sign in with Email');
  await page.waitForSelector('input[name="email"]', { state: 'visible', timeout: 8000 });
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', 'password12345');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}),
    page.click('button[type="submit"]:visible'),
  ]);
  // A fresh browser is a new device: the six digits come from the mail log.
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

  await page.goto(`${BASE}/social/messages`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.tma-dash__messages-row', { timeout: 15000 });
  // A fresh account's sidebar is a hover overlay; a pointer left on it keeps
  // it open over the page.
  await page.mouse.move(900, 600);
  await page.waitForTimeout(1500);
  return page;
}

// By the row's own name, not anything it says: a preview can name anybody.
const row = (page, name) => page
  .locator(`.tma-dash__messages-row:has(.tma-dash__messages-row-name-text:text-is("${name}"))`)
  .first();
const bubble = (page, text) => page.locator('.tma-dash__messages-bubble-row', { hasText: text }).last();

async function eventually(page, ms, probe) {
  for (let waited = 0; waited < ms; waited += 200) {
    if (await probe()) return true;
    await page.waitForTimeout(200);
  }
  return false;
}

/* Type lines into the message box the way a person does: Shift+Enter between. */
async function typeLines(page, lines) {
  await page.click('[data-messages-composer-input]');
  for (let i = 0; i < lines.length; i++) {
    if (i) await page.keyboard.press('Shift+Enter');
    if (lines[i]) await page.keyboard.type(lines[i]);
  }
}

/* How one bubble's text is laid out: its plain lines, its list, where things sit. */
const layout = (target) => target.locator('.tma-dash__messages-bubble-copy').evaluate((copy) => {
  const box = (el) => { const b = el.getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top), bottom: Math.round(b.bottom) }; };
  const items = Array.from(copy.querySelectorAll('.tma-dash__messages-copy-item')).map((item) => ({
    mark: item.querySelector('.tma-dash__messages-copy-mark').textContent,
    text: item.querySelector('.tma-dash__messages-copy-text').textContent,
    nested: item.classList.contains('tma-dash__messages-copy-item--nested'),
    textX: box(item.querySelector('.tma-dash__messages-copy-text')).x,
    ...box(item),
  }));
  return {
    breaks: copy.querySelectorAll('br').length,
    gaps: copy.querySelectorAll('.tma-dash__messages-copy-gap').length,
    lists: copy.querySelectorAll('.tma-dash__messages-copy-list').length,
    items,
    text: copy.innerText,
    // An inline run has a box for each row it is drawn on (and may have an
    // empty one at a break), so rows are counted by where the boxes sit.
    rows: new Set(Array.from(copy.getClientRects()).filter((r) => r.width > 0).map((r) => Math.round(r.top))).size,
  };
});

/*
 * The inbox column, measured. A message's bullet list was first given the
 * class the column itself has, and the rule that made the list a block made
 * the column one: its bar left the bottom and the New message button sat on
 * the last conversation. Nothing in a bubble may reach it.
 */
const inbox = (page) => page.evaluate(() => {
  const box = (el) => el.getBoundingClientRect();
  const columns = document.querySelectorAll('.tma-dash__messages-list');
  const column = columns[0];
  const style = getComputedStyle(column);
  const foot = box(column.querySelector('.tma-dash__messages-list-foot'));
  const body = box(column.querySelector('.tma-dash__messages-list-body'));
  const fab = box(column.querySelector('.tma-dash__messages-fab'));
  const chat = box(document.querySelector('.tma-dash__messages-chat'));
  const rows = Array.from(column.querySelectorAll('.tma-dash__messages-row')).map(box);
  const last = rows[rows.length - 1];
  return {
    count: columns.length,
    display: style.display,
    direction: style.flexDirection,
    footToBottom: Math.round(box(column).bottom - foot.bottom),
    columnToChat: Math.round(Math.abs(box(column).bottom - chat.bottom)),
    bodyToFoot: Math.round(foot.top - body.bottom),
    fabAboveFoot: fab.bottom <= foot.top + 1,
    // Only a short list leaves room to tell: the button must not sit on a row.
    fabClearOfRows: !last || last.bottom <= fab.top || fab.right <= last.left || rows.length > 8,
    spare: Math.round(foot.top - (last ? last.bottom : body.top)),
  };
});

async function checkInbox(page, when) {
  const i = await inbox(page);
  check(i.count === 1, `${when}: one element carries the inbox column's class (${i.count})`);
  check(i.display === 'flex' && i.direction === 'column', `${when}: the column is still a flex column (${i.display} ${i.direction})`);
  check(i.footToBottom >= 0 && i.footToBottom <= 2 && i.columnToChat <= 2,
    `${when}: its bar is at the bottom, level with the chat beside it (${i.footToBottom}px, ${i.columnToChat}px)`);
  check(i.bodyToFoot >= 0 && i.bodyToFoot <= 16, `${when}: the list reaches down to the bar (${i.bodyToFoot}px)`);
  check(i.fabAboveFoot && i.fabClearOfRows, `${when}: New message floats above the bar, clear of the conversations (${i.spare}px spare under the last one)`);
}

let a, b;
try {
  step(1, 'Two lines typed with Shift+Enter arrive as two lines');
  a = await session(USER_A);
  b = await session(USER_B);
  await row(a, 'Ana Ruiz').click();
  await row(b, 'Test User').click();
  await a.waitForTimeout(1000);
  await checkInbox(a, 'before anything is sent');

  const stamp = Date.now();
  const first = `First line ${stamp}`;
  await typeLines(a, [first, 'Second line']);
  await a.click('[data-messages-composer-send]');

  check(await eventually(a, 6000, async () => (await bubble(a, first).count()) === 1), 'A sees the message');
  const mine = await layout(bubble(a, first));
  check(mine.breaks === 1, `the bubble keeps the break (${mine.breaks})`);
  check(mine.text === `${first}\nSecond line`, 'the two lines are two lines, not one word run together');
  check(mine.rows === 2, `and are drawn on two rows (${mine.rows})`);

  check(await eventually(b, 8000, async () => (await bubble(b, first).count()) === 1), 'B gets it live');
  const theirs = await layout(bubble(b, first));
  check(theirs.breaks === 1 && theirs.text === `${first}\nSecond line`, 'laid out the same for the person reading it');

  step(2, 'Lines that begin with a number or a bullet are set as a list');
  const agenda = `Agenda ${stamp}`;
  await typeLines(a, [agenda, '1. Budget', '* Travel and accommodation for the two site visits in November', '- Fees', '2. Hiring', '', 'Thanks']);
  await a.click('[data-messages-composer-send]');
  check(await eventually(a, 6000, async () => (await bubble(a, agenda).count()) === 1), 'A sees the message');

  for (const [who, page] of [['A', a], ['B', b]]) {
    await eventually(page, 8000, async () => (await bubble(page, agenda).count()) === 1);
    const l = await layout(bubble(page, agenda));
    const marks = l.items.map((i) => i.mark).join(' ');
    check(l.items.length === 4 && marks === '1. • • 2.', `${who}: four items, numbered as typed and bulleted (${marks})`);
    check(l.items[0].text === 'Budget' && l.items[3].text === 'Hiring', `${who}: the marker is not repeated in the text`);
    check(!/[*]/.test(l.text) && !/^- /m.test(l.text), `${who}: no asterisk or dash is left showing`);
    check(l.items.every((item, i) => !i || item.y >= l.items[i - 1].bottom - 1), `${who}: each item is on a row of its own`);
    check(l.items[1].nested && l.items[2].nested && !l.items[0].nested && !l.items[3].nested,
      `${who}: the bullets sit under the number they follow`);
    check(l.items[1].textX > l.items[0].textX, `${who}: and are indented further than it (${l.items[1].textX} > ${l.items[0].textX})`);
    check(l.gaps === 1, `${who}: the blank line before "Thanks" is a gap (${l.gaps})`);
    check(l.text.trim().endsWith('Thanks'), `${who}: and "Thanks" comes after the list`);
  }

  // A long item wraps under its own first word, not under its marker.
  const wrapped = await bubble(b, agenda).locator('.tma-dash__messages-copy-item').nth(1).evaluate((item) => {
    const mark = item.querySelector('.tma-dash__messages-copy-mark').getBoundingClientRect();
    const text = item.querySelector('.tma-dash__messages-copy-text').getBoundingClientRect();
    return { markRight: Math.round(mark.right), textLeft: Math.round(text.left) };
  });
  check(wrapped.textLeft >= wrapped.markRight, 'an item\'s text stays to the right of its marker');

  // The list is on screen now, in both threads: the column must not have moved.
  await checkInbox(a, 'with a list in the thread');
  await checkInbox(b, 'for the person reading it');

  step(3, 'One line is left as somebody talking');
  const dash = `- ok ${stamp}`;
  await typeLines(a, [dash]);
  await a.click('[data-messages-composer-send]');
  check(await eventually(a, 6000, async () => (await bubble(a, dash).count()) === 1), 'A sees the message');
  const plain = await layout(bubble(a, dash));
  check(plain.lists === 0 && plain.text === dash, `"- ok" stays "- ok" (${plain.text})`);

  step(4, 'Pasted text keeps its lines, and markup in it stays text');
  const pasted = `Pasted ${stamp}`;
  await a.click('[data-messages-composer-input]');
  await a.evaluate((text) => {
    const input = document.querySelector('[data-messages-composer-input]');
    const data = new DataTransfer();
    data.setData('text/plain', text);
    input.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, `${pasted}\n• one <b>bold</b>\n• two`);
  await a.click('[data-messages-composer-send]');
  check(await eventually(b, 8000, async () => (await bubble(b, pasted).count()) === 1), 'B gets it');
  const paste = await layout(bubble(b, pasted));
  check(paste.items.length === 2 && paste.items[0].text === 'one <b>bold</b>', `two bullets, the tags shown as typed (${paste.items[0] && paste.items[0].text})`);
  check((await bubble(b, pasted).locator('.tma-dash__messages-bubble-copy b').count()) === 0, 'and never turned into markup');

  step(5, 'It is the stored message that has the lines: a reload draws it the same');
  await b.reload({ waitUntil: 'networkidle' });
  await b.waitForSelector('.tma-dash__messages-row', { timeout: 15000 });
  await b.mouse.move(900, 600);
  await row(b, 'Test User').click();
  check(await eventually(b, 8000, async () => (await bubble(b, agenda).count()) === 1), 'the thread loads again');
  const again = await layout(bubble(b, agenda));
  check(again.items.length === 4 && again.gaps === 1, `the list and the gap are still there (${again.items.length} items)`);

  step(6, 'A draft keeps its lines while it waits');
  const draft = `Draft ${stamp}`;
  await typeLines(a, [draft, 'still writing']);
  await a.waitForTimeout(1200); // the draft save is debounced
  await row(a, 'Peer 01').click();
  await a.waitForTimeout(800);
  await row(a, 'Ana Ruiz').click();
  await a.waitForTimeout(800);
  const held = await a.locator('[data-messages-composer-input]').evaluate((el) => el.innerText.trim());
  check(held === `${draft}\nstill writing`, `coming back to the conversation finds both lines (${JSON.stringify(held)})`);
  await a.locator('[data-messages-composer-input]').fill('');
  await a.waitForTimeout(900);

  step(7, 'An announcement written in sections is drawn in sections');
  await row(a, GROUP).click();
  await a.waitForTimeout(1000);
  await a.click('[data-messages-conversation-menu]');
  await a.click('[data-conv-action="announce"]');
  await a.waitForSelector('.tma-portal-modal [data-messages-announce-body]', { timeout: 5000 });
  const news = `PORTAL UPDATES ${stamp}`;
  await a.fill('[data-messages-announce-body]', [
    news,
    '',
    'Several improvements to the portal.',
    '',
    '1. Improved Performance',
    '* Faster loading for the applications table.',
    '* Pages load with their content ready.',
    '',
    '2. Document Management',
    '* Documents can be uploaded from the checklist.',
    '',
    'More to come.',
  ].join('\n'));
  await a.click('[data-messages-announce-save]');
  await eventually(a, 6000, async () => (await a.locator('.tma-portal-modal').count()) === 0);
  check(await eventually(a, 6000, async () => (await bubble(a, news).count()) === 1), 'it is posted');
  const posted = await layout(bubble(a, news));
  const postedMarks = posted.items.map((i) => i.mark).join(' ');
  check(postedMarks === '1. • • 2. •', `two numbered sections with their points (${postedMarks})`);
  check(posted.gaps === 4, `the blank lines between them are gaps (${posted.gaps})`);
  check(posted.items[0].text === 'Improved Performance' && posted.items[3].text === 'Document Management', 'the headings read as headings');
  check(posted.items.filter((i) => i.nested).length === 3, 'and the points sit under them');
  step(8, 'Bold and italic are drawn, and nothing else is taken for them');
  await row(a, 'Ana Ruiz').click();
  await a.waitForTimeout(800);
  const marked = `Emphasis ${stamp}`;
  await typeLines(a, [`${marked} *Important* and _quietly_ and **also** but 2*3*4 and snake_case_name and *their`]);
  await a.click('[data-messages-composer-send]');

  /* What a bubble draws as bold and as italic, and how. */
  const emphasis = (target) => target.locator('.tma-dash__messages-bubble-copy').evaluate((copy) => {
    const strong = Array.from(copy.querySelectorAll('strong'));
    const em = Array.from(copy.querySelectorAll('em'));
    return {
      bold: strong.map((el) => el.textContent),
      italic: em.map((el) => el.textContent),
      weight: strong.length ? Number(getComputedStyle(strong[0]).fontWeight) : 0,
      base: Number(getComputedStyle(copy).fontWeight),
      slant: em.length ? getComputedStyle(em[0]).fontStyle : '',
      text: copy.innerText,
      links: Array.from(copy.querySelectorAll('a')).map((el) => el.getAttribute('href')),
    };
  });

  for (const [who, page] of [['A', a], ['B', b]]) {
    check(await eventually(page, 8000, async () => (await bubble(page, marked).count()) === 1), `${who} sees the message`);
    const e = await emphasis(bubble(page, marked));
    check(e.bold.join('|') === 'Important|also', `${who}: *Important* and **also** are bold (${e.bold.join('|')})`);
    check(e.italic.join('|') === 'quietly', `${who}: _quietly_ is italic (${e.italic.join('|')})`);
    check(e.weight >= 600 && e.weight > e.base && e.slant === 'italic', `${who}: and are really drawn so (${e.weight} over ${e.base}, ${e.slant})`);
    check(!e.text.includes('*Important*') && !e.text.includes('_quietly_') && !e.text.includes('**'), `${who}: with their marks gone`);
    check(e.text.includes('2*3*4') && e.text.includes('snake_case_name') && e.text.includes('*their'),
      `${who}: arithmetic, an identifier and a correction are left as typed`);
  }
  check(await eventually(a, 4000, async () => (await row(a, 'Ana Ruiz').textContent()).includes('Important and quietly and also')),
    "the chat list reads it as one plain line, without the marks");

  step(9, 'Inside a list, around a link, and across the dialog');
  const notes = `Notes ${stamp}`;
  await typeLines(a, [notes, '* *Key point* first', '1. see https://example.com/a_b_c/_x_ for _details_']);
  await a.click('[data-messages-composer-send]');
  check(await eventually(b, 8000, async () => (await bubble(b, notes).count()) === 1), 'B gets it');
  const inList = await emphasis(bubble(b, notes));
  check(inList.bold.join('|') === 'Key point' && inList.italic.join('|') === 'details', `a bullet holds bold and a numbered line italic (${inList.bold.join('|')} / ${inList.italic.join('|')})`);
  check(inList.links.join('|') === 'https://example.com/a_b_c/_x_', `the address keeps its underscores and is one link (${inList.links.join('|')})`);

  step(10, 'Ctrl or Cmd with B and I type the marks, in the box and in a dialog');
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
  const keyed = `Keys ${stamp}`;
  await a.click('[data-messages-composer-input]');
  await a.keyboard.type(`${keyed} make this bold`);
  for (let i = 0; i < 4; i++) await a.keyboard.press('Shift+ArrowLeft');
  await a.keyboard.press(`${mod}+b`);
  const box = a.locator('[data-messages-composer-input]');
  check((await box.evaluate((el) => el.innerText.trim())) === `${keyed} make this *bold*`, 'with a word selected, the marks go round it');
  check((await box.locator('b, strong, i, em').count()) === 0, 'and the box itself is not styled: what you see is what is sent');

  await a.keyboard.type(' and ');
  await a.keyboard.press(`${mod}+i`);
  await a.keyboard.type('slanted');
  check((await box.evaluate((el) => el.innerText.trim())) === `${keyed} make this *bold* and _slanted_`, 'with nothing selected, a pair is typed and the caret left inside it');
  await a.click('[data-messages-composer-send]');
  check(await eventually(b, 8000, async () => (await bubble(b, keyed).count()) === 1), 'B gets it');
  const byKey = await emphasis(bubble(b, keyed));
  check(byKey.bold.join('|') === 'bold' && byKey.italic.join('|') === 'slanted', `and it arrives bold and italic (${byKey.bold.join('|')} / ${byKey.italic.join('|')})`);

  await row(a, GROUP).click();
  await a.waitForTimeout(800);
  await a.click('[data-messages-conversation-menu]');
  await a.click('[data-conv-action="announce"]');
  await a.waitForSelector('.tma-portal-modal [data-messages-announce-body]', { timeout: 5000 });
  await a.fill('[data-messages-announce-body]', 'Office closed');
  await a.locator('[data-messages-announce-body]').press(`${mod}+a`);
  await a.locator('[data-messages-announce-body]').press(`${mod}+b`);
  check((await a.inputValue('[data-messages-announce-body]')) === '*Office closed*', 'the same key marks an announcement being written');
  await a.keyboard.press('Escape');

  await bubble(a, news).scrollIntoViewIfNeeded();
  await a.waitForTimeout(400);
  await a.screenshot({ path: new URL('./messaging-text-layout.png', import.meta.url).pathname });
  log('\nwrote messaging-text-layout.png');
} catch (err) {
  failures.push('threw: ' + err.message);
  log('\nERROR: ' + err.message);
} finally {
  await browser.close();
}

log('\n' + (failures.length ? `FAILED (${failures.length})` : 'ALL CHECKS PASSED'));
failures.forEach((f) => log('  ✗ ' + f));
process.exit(failures.length ? 1 : 0);
