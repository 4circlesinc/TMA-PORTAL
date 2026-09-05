import { chromium } from 'playwright';

/*
 * The reading pane on a phone. A 390px screen used to get the desktop row:
 * the subject truncated to "INTRODUC…" beside the chips, the sender to
 * "Hiros…", the recipient wrapped into a three-line column, and the date
 * and five action icons crammed together — because the phone layout in
 * renderMessageHead was keyed on a head name no caller ever passed.
 *
 * So this measures the pane, not its markup: the page never scrolls
 * sideways; the subject wraps in full with the star beside its first line
 * and the label chips on a row of their own; every message head is the
 * two-row grid (name and actions, then recipient and a short date) with
 * nothing overlapping and every tap target inside the viewport; the "to …"
 * details panel fits; quoted history still toggles; and a message with a
 * 1400px image and a 1200px table keeps its picture inside the pane and
 * scrolls its table inside its own frame rather than moving the page.
 *
 * Runs the same checks at a 768px tablet width, which is still the phone
 * layout (isEmailMobile is ≤1024px).
 *
 * See README.md for setup: the mailbox fixture plus the long-subject
 * conversation and the wide newsletter seeded there.
 */
const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8899';
const EMAIL = process.env.TMA_STAFF_EMAIL || 'e2e@example.com';
const OUT = process.env.TMA_SHOT_DIR || 'tests/Browser';

const log = (...a) => console.log(...a);
const failures = [];
function step(n, msg) { log(`\n[${n}] ${msg}`); }
function check(ok, msg) {
  log(`    ${ok ? '✓' : '✗'} ${msg}`);
  if (!ok) failures.push(msg);
}

const NOISE = [/409/, /WebSocket|ws:\/\/|wss:\/\//i, /Failed to load resource/, /net::ERR/, /reconnect/i, /reverb|pusher/i];
const real = (errors) => errors.filter((t) => !NOISE.some((re) => re.test(t)));

const SUBJECT = 'INTRODUCTION TO THE CITIZENSHIP BY INVESTMENT PROGRAMME';
const LIST_ROW = '.tma-dash__email-row[data-email-row]';

const browser = await chromium.launch();

async function signIn(page) {
  await page.goto(`${BASE}/auth/login`, { waitUntil: 'networkidle' });
  await page.click('text=Sign in with Email');
  await page.waitForSelector('input[name="email"]', { state: 'visible', timeout: 8000 });
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', 'password12345');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}),
    page.click('button[type="submit"]:visible'),
  ]);
  await page.waitForTimeout(400);
  if (page.url().includes('/auth/stay-signed-in')) {
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}),
      page.click('button[type="submit"]:visible'),
    ]);
    await page.waitForTimeout(400);
  }
  if (page.url().includes('/auth/login')) throw new Error('login failed');
}

async function openMessage(page, text) {
  await page.goto(`${BASE}/email`, { waitUntil: 'networkidle' });
  await page.waitForSelector(LIST_ROW, { timeout: 15000 });
  await page.click(`${LIST_ROW}:has-text("${text}")`);
  await page.waitForSelector('.tma-dash--email-mobile-reading', { timeout: 10000 });
  await page.waitForSelector('.tma-dash__email-message-head--mobile', { timeout: 10000 });
  // Frames size themselves a beat after the paint.
  await page.waitForTimeout(1500);
}

/* Everything the layout promises, measured. */
function measure(page) {
  return page.evaluate(() => {
    const vw = window.innerWidth;
    const box = (el) => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
    const inside = (b) => b.left >= -0.5 && b.right <= vw + 0.5;
    const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    const scroll = document.querySelector('.tma-dash__email-detail-scroll');
    const subjectText = document.querySelector('.tma-dash__email-detail-subject-text');
    const subjectStar = document.querySelector('.tma-dash__email-detail-subject-trailing [data-email-star]');
    const labelsRow = document.querySelector('.tma-dash__email-detail-subject-labels--row');
    const chips = Array.from(document.querySelectorAll('.tma-dash__email-detail-subject-labels--row .tma-dash__email-detail-label-chip'));
    const heads = Array.from(document.querySelectorAll('.tma-dash__email-message-head'));
    const frames = Array.from(document.querySelectorAll('[data-email-body-frame]'));
    return {
      vw,
      pageOverflow: document.documentElement.scrollWidth > vw || document.body.scrollWidth > vw,
      paneOverflow: scroll ? scroll.scrollWidth > scroll.clientWidth + 1 : null,
      subject: subjectText ? {
        text: subjectText.textContent.trim(),
        font: parseFloat(getComputedStyle(subjectText).fontSize),
        whiteSpace: getComputedStyle(subjectText).whiteSpace,
        clipped: subjectText.scrollWidth > subjectText.clientWidth + 1,
        lines: Math.round(subjectText.getBoundingClientRect().height / parseFloat(getComputedStyle(subjectText).lineHeight)),
        box: box(subjectText),
      } : null,
      star: subjectStar ? Object.assign(box(subjectStar), { inside: inside(box(subjectStar)) }) : null,
      labelsRow: labelsRow ? box(labelsRow) : null,
      chips: chips.map((c) => Object.assign(box(c), { text: c.textContent.trim(), inside: inside(box(c)) })),
      heads: heads.map((h) => {
        const name = h.querySelector('.tma-dash__email-message-head-name');
        const to = h.querySelector('.tma-dash__email-message-head-to');
        const toLabel = h.querySelector('.tma-dash__email-message-head-to-label');
        const date = h.querySelector('.tma-dash__email-detail-date');
        const actions = h.querySelector('.tma-dash__email-detail-actions');
        const buttons = Array.from(h.querySelectorAll('.tma-dash__email-detail-actions button'));
        const nb = name && box(name), ab = actions && box(actions), tb = to && box(to), db = date && box(date);
        return {
          mobile: h.classList.contains('tma-dash__email-message-head--mobile'),
          headOverflow: h.scrollWidth > h.clientWidth + 1,
          name: name && name.textContent.trim(),
          nameInside: nb && inside(nb),
          nameClearOfActions: nb && ab ? !overlaps(nb, ab) : null,
          toLines: tb ? Math.round(tb.height / 16) : null,
          toInside: tb && inside(tb),
          toClearOfDate: tb && db ? !overlaps(tb, db) : null,
          toBelowName: tb && nb ? tb.top >= nb.bottom - 1 : null,
          toEllipsis: toLabel ? getComputedStyle(toLabel).textOverflow === 'ellipsis' : null,
          date: db && date.textContent.trim(),
          dateInside: db && inside(db),
          dateBelowActions: db && ab ? db.top >= ab.bottom - 1 : null,
          buttons: buttons.map((b) => Object.assign(box(b), { label: b.getAttribute('aria-label'), inside: inside(box(b)) })),
        };
      }),
      frames: frames.map((f) => {
        let docWidth = null, imgWidths = [];
        try {
          const d = f.contentDocument;
          docWidth = d ? Math.max(d.documentElement.scrollWidth, d.body ? d.body.scrollWidth : 0) : null;
          imgWidths = d ? Array.from(d.images).map((i) => i.getBoundingClientRect().width) : [];
        } catch (e) { /* sandboxed */ }
        return Object.assign(box(f), { inside: inside(box(f)), clientWidth: f.clientWidth, docWidth, imgWidths });
      }),
    };
  });
}

async function runAt(label, viewport) {
  const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  step(label, `Inbox at ${viewport.width}px: row type sized so the preview has room`);
  await signIn(page);
  await page.goto(`${BASE}/email`, { waitUntil: 'networkidle' });
  await page.waitForSelector(LIST_ROW, { timeout: 15000 });
  const rowType = await page.evaluate(() => {
    const px = (sel) => { const el = document.querySelector(sel); return el ? parseFloat(getComputedStyle(el).fontSize) : null; };
    return { sender: px('.tma-dash__email-row-sender'), subject: px('.tma-dash__email-row-subject-text'), snippet: px('.tma-dash__email-row-snippet'), time: px('.tma-dash__email-row-time') };
  });
  check(rowType.sender !== null && rowType.sender <= 14, `sender at ${rowType.sender}px`);
  check(rowType.subject !== null && rowType.subject <= 13 && rowType.snippet !== null && rowType.snippet <= 13, `subject and preview at ${rowType.subject}px / ${rowType.snippet}px`);
  check(rowType.time !== null && rowType.time <= 12, `time at ${rowType.time}px`);
  // The right of a row is not a column of its own: the time rides the sender
  // line, the star rides the preview line, and the subject and attachment
  // chips run the full width beneath the time.
  const shape = await page.evaluate(() => {
    const row = Array.from(document.querySelectorAll('.tma-dash__email-row[data-email-row]')).find((r) => r.querySelector('.tma-dash__email-row-attachments'));
    if (!row) return null;
    const b = (sel) => { const el = row.querySelector(sel); return el ? el.getBoundingClientRect() : null; };
    const sender = b('.tma-dash__email-row-sender'), time = b('.tma-dash__email-row-time'), subject = b('.tma-dash__email-row-subject');
    const snippet = b('.tma-dash__email-row-snippet'), star = b('.tma-dash__email-row-star-mobile'), chips = b('.tma-dash__email-row-attachments');
    const rowBox = row.getBoundingClientRect();
    const rightPad = parseFloat(getComputedStyle(row).paddingRight);
    const inner = rowBox.right - rightPad;
    return {
      timeOnSenderLine: Math.abs((time.top + time.bottom) / 2 - (sender.top + sender.bottom) / 2) <= 4,
      subjectFullWidth: subject.right >= inner - 1 && subject.right > star.left + 10,
      chipsFullWidth: chips.right >= inner - 1 && chips.right > star.left + 10,
      starOnPreviewLine: (star.top + star.bottom) / 2 > snippet.top - 2 && (star.top + star.bottom) / 2 < snippet.bottom + 2,
      previewClearOfStar: snippet.right <= star.left + 0.5,
      chipsBelowPreview: chips.top >= snippet.bottom - 1,
    };
  });
  check(!!shape && shape.timeOnSenderLine, 'the time rides the sender line');
  check(!!shape && shape.subjectFullWidth, 'the subject runs the full width beneath it');
  check(!!shape && shape.starOnPreviewLine && shape.previewClearOfStar, 'the star rides the preview line, after the preview');
  check(!!shape && shape.chipsFullWidth && shape.chipsBelowPreview, 'attachment chips run the full width on their own line');

  // The list keeps its place through a full repaint: the scrolling body is
  // keyed, so a banner appearing before it cannot make the morph replace it.
  const kept = await page.evaluate(async () => {
    const body = document.querySelector('.tma-dash__email-list-body');
    if (!body || body.scrollHeight <= body.clientHeight + 50) return { skipped: true };
    body.scrollTop = Math.min(400, body.scrollHeight - body.clientHeight);
    const want = body.scrollTop;
    document.querySelector('[data-email]')._emailRender();
    await new Promise((r) => setTimeout(r, 300));
    const after = document.querySelector('.tma-dash__email-list-body');
    const out = { want, afterRender: after.scrollTop, sameNode: after === body };
    after.scrollTop = 0;
    return out;
  });
  check(kept.skipped || (kept.sameNode && kept.afterRender === kept.want), kept.skipped ? 'the list is too short here to scroll (repaint check skipped)' : `the list keeps its place through a full repaint (${kept.want} → ${kept.afterRender})`);

  // The conversation arrow sits in line with the avatar, just before it.
  const arrow = await page.evaluate(() => {
    const toggle = document.querySelector('.tma-dash__email-row[data-email-row] [data-email-conversation-toggle]');
    if (!toggle) return null;
    const row = toggle.closest('.tma-dash__email-row');
    const avatar = row.querySelector('.tma-dash__email-row-avatar, .tma-dash__email-row-icon');
    const t = toggle.getBoundingClientRect(), a = avatar ? avatar.getBoundingClientRect() : null, r = row.getBoundingClientRect();
    const mid = (t.top + t.bottom) / 2;
    return {
      left: t.left, right: t.right, rowLeft: r.left,
      avatarLeft: a ? a.left : null,
      beforeAvatar: a ? t.right <= a.left + 0.5 : null,
      levelWithAvatar: a ? mid > a.top + 8 && mid < a.bottom - 8 : null,
    };
  });
  check(!!arrow && arrow.beforeAvatar && arrow.left >= arrow.rowLeft - 0.5, `the conversation arrow sits before the avatar (arrow ends ${arrow && Math.round(arrow.right)}px, avatar starts ${arrow && Math.round(arrow.avatarLeft)}px)`);
  check(!!arrow && arrow.levelWithAvatar, 'and level with it, not under it');

  step(label, `Thread at ${viewport.width}px: nothing runs off the screen`);
  await openMessage(page, 'INTRODUCTION');
  let m = await measure(page);
  check(!m.pageOverflow, 'the page has no horizontal overflow');
  check(m.paneOverflow === false, 'the reading pane has no horizontal overflow');
  await page.screenshot({ path: `${OUT}/mail-thread-mobile-${viewport.width}.png` });

  // An open message owns the screen: no bottom navigation, and the reply
  // bar at the bottom instead of behind it.
  const chrome = await page.evaluate(() => {
    const bar = document.querySelector('.tma-dash__tabbar');
    const footer = document.querySelector('.tma-dash__email-detail-mobile-footer');
    const visible = (el) => !!el && el.offsetWidth > 0 && el.offsetHeight > 0 && getComputedStyle(el).display !== 'none';
    const fr = footer && footer.getBoundingClientRect();
    return {
      tabbar: visible(bar),
      footer: visible(footer),
      footerBottom: fr ? Math.round(fr.bottom) : null,
      vh: window.innerHeight,
      footerClear: fr && bar ? !(bar.offsetHeight && fr.bottom > bar.getBoundingClientRect().top) : true,
    };
  });
  check(!chrome.tabbar, 'the bottom navigation is hidden while a message is open');
  check(chrome.footer && chrome.footerBottom !== null && chrome.footerBottom <= chrome.vh + 0.5, `the reply bar sits within the screen (bottom ${chrome.footerBottom} of ${chrome.vh})`);
  const pills = await page.$$eval('.tma-dash__email-thread-actions--mobile .tma-dash__email-thread-btn', (els) => els.map((el) => ({
    label: el.textContent.trim(), oneLine: el.getBoundingClientRect().height <= 48, fits: el.scrollWidth <= el.clientWidth + 1,
  })));
  check(pills.length === 3 && pills.every((p) => p.oneLine && p.fits), `Reply, Reply all and Forward each hold one line (${pills.map((p) => p.label).join(' / ')})`);
  check(!(await page.$('.tma-dash__email-thread-react')), 'no dead reaction button beside them');

  step(label, 'The subject wraps in full, star beside it, labels on their own row');
  check(!!m.subject && m.subject.text.startsWith(SUBJECT), `the full subject is there (got "${m.subject && m.subject.text.slice(0, 40)}…")`);
  check(!!m.subject && m.subject.whiteSpace !== 'nowrap' && !m.subject.clipped, 'it wraps instead of truncating');
  check(!!m.subject && m.subject.lines >= 2, `over more than one line (${m.subject && m.subject.lines})`);
  check(!!m.subject && m.subject.font <= 17, `at ${m.subject && m.subject.font}px`);
  check(!!m.star && m.star.inside, 'the star is on screen');
  check(!!m.star && !!m.subject && m.star.top < m.subject.box.top + 30, 'and level with the first line of the subject');
  check(m.chips.length >= 1 && m.chips.every((c) => c.inside), `label chips fit the screen (${m.chips.map((c) => c.text).join(', ')})`);
  check(!!m.labelsRow && !!m.subject && m.labelsRow.top >= m.subject.box.bottom - 1, 'and sit under the subject, not beside it');

  step(label, 'Every message head is the two-row phone grid');
  check(m.heads.length >= 1, `${m.heads.length} message head(s) on screen`);
  check(m.heads.every((h) => h.mobile), 'all of them use the phone layout');
  check(m.heads.every((h) => !h.headOverflow), 'none overflows its box');
  check(m.heads.every((h) => h.nameInside && h.nameClearOfActions), 'the sender name stays clear of the action buttons');
  check(m.heads.every((h) => h.toLines === 1 && h.toInside && h.toEllipsis), 'the recipient is one line, ellipsised, on screen');
  check(m.heads.every((h) => h.toBelowName && h.toClearOfDate), 'it sits under the name and clear of the date');
  check(m.heads.every((h) => h.dateInside && h.dateBelowActions), `the date is on screen under the actions (${m.heads[0] && m.heads[0].date})`);
  check(m.heads.every((h) => h.date && !/\d{4}/.test(h.date)), 'in its short form for this year');
  check(m.heads.every((h) => h.buttons.length === 3 && h.buttons.every((b) => b.inside && b.width >= 36 && b.height >= 36)),
    'three actions, each a 36px target on screen');

  step(label, 'Frames stay inside the pane');
  check(m.frames.length >= 1 && m.frames.every((f) => f.inside), 'every body frame is on screen');
  check(m.frames.every((f) => f.docWidth === null || f.docWidth <= f.clientWidth + 1), 'plain messages do not scroll sideways inside their frame');

  step(label, 'The "to …" details panel fits, and quoted history toggles');
  await page.click('.tma-dash__email-message-head--mobile [data-email-header-details-toggle]');
  await page.waitForTimeout(300);
  const panel = await page.$eval('[data-email-header-details-panel]:not([hidden])', (el) => {
    const r = el.getBoundingClientRect();
    return { left: r.left, right: r.right, vw: window.innerWidth, overflow: el.scrollWidth > el.clientWidth + 1 };
  }).catch(() => null);
  check(!!panel && panel.left >= 0 && panel.right <= panel.vw && !panel.overflow, 'the details panel is within the viewport');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  // The pane shows one message of a conversation; the reply carrying the
  // quote is the middle one, reached through the list's conversation drop.
  await page.goto(`${BASE}/email`, { waitUntil: 'networkidle' });
  await page.waitForSelector(LIST_ROW, { timeout: 15000 });
  check(await page.$eval('.tma-dash__tabbar', (el) => el.offsetHeight > 0 && getComputedStyle(el).display !== 'none'), 'the bottom navigation is back on the inbox list');
  // Scrolled a little first: opening the drop must not move the list.
  const scrolledTo = await page.evaluate(() => {
    const body = document.querySelector('.tma-dash__email-list-body');
    body.scrollTop = Math.min(120, Math.max(0, body.scrollHeight - body.clientHeight));
    return body.scrollTop;
  });
  await page.click(`${LIST_ROW}:has-text("INTRODUCTION") [data-email-conversation-toggle]`);
  await page.waitForSelector(`${LIST_ROW}:has-text("Hiroshi Mabuchi")`, { timeout: 10000 });
  await page.waitForTimeout(400);
  const afterDrop = await page.evaluate(() => document.querySelector('.tma-dash__email-list-body').scrollTop);
  check(afterDrop === scrolledTo, `opening the drop leaves the list where it was (${scrolledTo} → ${afterDrop})`);
  // The arrow must open the drop only: a tap on it used to open the message
  // too, and the pane hid the drop it had just opened.
  check(!(await page.$('.tma-dash--email-mobile-reading')), 'the conversation arrow opens the drop without opening the message');
  const drop = await page.evaluate(() => {
    // The parent's content wrapper is `display: contents`, so measure the
    // sender line itself on both rows.
    const child = document.querySelector('.tma-dash__email-row--child');
    const group = child && child.closest('.tma-dash__email-thread-children');
    const parent = group && group.parentElement.querySelector('.tma-dash__email-row:not(.tma-dash__email-row--child) .tma-dash__email-row-head');
    const cc = child && child.querySelector('.tma-dash__email-row-head, .tma-dash__email-row-sender');
    return parent && cc ? { parent: Math.round(parent.getBoundingClientRect().left), child: Math.round(cc.getBoundingClientRect().left) } : null;
  });
  check(!!drop && Math.abs(drop.parent - drop.child) <= 1, `the drop's messages line up under the parent's text (${drop && drop.parent}px vs ${drop && drop.child}px)`);
  await page.click(`${LIST_ROW}:has-text("Hiroshi Mabuchi")`);
  await page.waitForSelector('.tma-dash--email-mobile-reading', { timeout: 10000 });
  await page.waitForSelector('[data-email-thread-quote]', { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(1200);
  const quote = await page.$('[data-email-thread-quote]');
  check(!!quote, 'the reply with history offers a quoted-text toggle');
  if (quote) {
    const toggleBox = await quote.boundingBox();
    check(!!toggleBox && toggleBox.x >= 15, `the toggle keeps the pane gutter (x=${toggleBox && Math.round(toggleBox.x)})`);
    // A programmatic click: the harness's floating sync toast can sit over
    // the bottom of the pane, and what is under test is the toggle, not
    // the toast.
    await quote.evaluate((el) => el.click());
    await page.waitForTimeout(1500);
    check((await page.$eval('[data-email-thread-quote]', (el) => el.getAttribute('aria-expanded'))) === 'true', 'and it opens');
    m = await measure(page);
    check(!m.pageOverflow && m.paneOverflow === false, 'with the history shown the page still does not scroll sideways');
    // The quote carried its own 16px; on a phone it reads at the reply's size.
    const sizes = await page.$eval('[data-email-body-frame]', (f) => {
      const d = f.contentDocument;
      const px = (el) => el ? parseFloat(d.defaultView.getComputedStyle(el).fontSize) : null;
      const quoted = d.querySelector('.gmail_quote p') || d.querySelector('.gmail_quote');
      const own = d.body.querySelector('div');
      return { own: px(own), quoted: px(quoted) };
    }).catch(() => null);
    check(!!sizes && sizes.quoted !== null && Math.abs(sizes.quoted - sizes.own) < 0.5, `quoted history reads at the reply's size (${sizes && sizes.own}px vs ${sizes && sizes.quoted}px)`);
  }

  step(label, 'A wide newsletter keeps the page put');
  await openMessage(page, 'Wide newsletter');
  m = await measure(page);
  check(!m.pageOverflow && m.paneOverflow === false, 'the page and pane have no horizontal overflow');
  const wide = m.frames[0];
  check(!!wide && wide.inside, 'the frame is inside the viewport');
  check(!!wide && wide.imgWidths.length === 1 && wide.imgWidths[0] <= wide.clientWidth, `the 1400px picture is held to the frame (${wide && Math.round(wide.imgWidths[0])}px of ${wide && wide.clientWidth}px)`);
  await page.screenshot({ path: `${OUT}/mail-thread-mobile-wide-${viewport.width}.png` });

  const bad = real(errors);
  check(bad.length === 0, bad.length ? 'console: ' + bad.join(' | ') : 'clean console');
  await context.close();
}

try {
  await runAt('phone', { width: 390, height: 844 });
  await runAt('tablet', { width: 768, height: 1024 });
} catch (e) {
  failures.push('threw: ' + e.message);
  log(e.stack);
}

await browser.close();
if (failures.length) {
  log('\nFAILED:\n - ' + failures.join('\n - '));
  process.exit(1);
}
log('\nAll checks passed.');
