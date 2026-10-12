import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

/*
 * The Messages tab of an application holds its thread.
 *
 * Two faults a long thread showed, both only visible in a browser:
 *
 *  - The tab's card was sized to the window, not to what it held. Every
 *    panel fills the height on offer and may be shrunk to it, which is right
 *    for Documents, whose list scrolls inside. A thread has no scroller of
 *    its own, the page behind it scrolls, so on a long one the card's
 *    background stopped at the fold and the messages, then the composer,
 *    ran on past its rounded corner onto the bare page. Activity did the
 *    same.
 *  - The sender's photo is aligned to the foot of the column that stacks a
 *    bubble with its reactions and its readers' faces, so with either under
 *    the bubble the photo dropped below it and sat beside those small faces.
 *
 * Pinned here, at a desktop width and at a phone's, light and dark:
 *
 *  - the card reaches below the last message, the composer and the two
 *    lists under it, and the thread's wash sits inside the card;
 *  - every sender's photo ends 2px above the foot of its bubble: with
 *    nothing under it, with a counted reaction and one reader's face, and
 *    with a reaction and two lines of readers' faces, all of which stay
 *    below the photo and under the bubble;
 *  - Activity is held by its card the same way;
 *  - Assigned and Portal access, which are short, still fill the height on
 *    offer, and Documents is still fitted to the window. Assigned is left
 *    as it was on purpose: its staff list scrolls inside the card.
 *
 * Needs the standard throwaway server with FEATURE_CIP=true, an
 * administrator (TMA_STAFF_EMAIL), and TMA_APP from
 * fixtures/messages-tab-seed.php. Read-only, so one seed serves every run.
 */
const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8899';
const EMAIL = process.env.TMA_STAFF_EMAIL || 'e2e@example.com';
const PASSWORD = process.env.TMA_STAFF_PASSWORD || 'password12345';
const APP = process.env.TMA_APP;
const LOG = process.env.TMA_LOG || 'storage/logs/laravel.log';
const SHOTS = process.env.TMA_SHOTS || '';

if (!APP) throw new Error('TMA_APP (an application uuid) is required (see fixtures/messages-tab-seed.php)');

/* The sign-in code, read out of the mail log (see cip-draft-autosave.mjs). */
function loginCode() {
  const text = readFileSync(LOG, 'utf8');
  const hits = [...text.matchAll(/letter-spacing:\.24em[^>]*>(\d{6})</g)];

  return hits.length ? hits[hits.length - 1][1] : null;
}

const failures = [];
const check = (ok, msg) => { console.log(`    ${ok ? '✓' : '✗'} ${msg}`); if (!ok) failures.push(msg); };
const step = (n, msg) => console.log(`\n[${n}] ${msg}`);

const browser = await chromium.launch();

async function signIn(page) {
  await page.goto(`${BASE}/auth/login`, { waitUntil: 'domcontentloaded' });
  await page.click('text=Sign in with Email');
  await page.waitForSelector('input[name="email"]', { state: 'visible' });
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}), page.click('button[type="submit"]:visible')]);
  await page.waitForTimeout(700);
  if (page.url().includes('/auth/login-code')) {
    await page.waitForTimeout(900);
    const code = loginCode();
    if (!code) throw new Error(`no sign-in code in ${LOG}`);
    await page.locator('.tma-auth__otp-digit').first().click();
    await page.keyboard.type(code, { delay: 40 });
    const trust = page.locator('input[type="checkbox"]').first();
    if (await trust.count()) await trust.check().catch(() => {});
    await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}), page.click('button[type="submit"]:visible')]);
    await page.waitForTimeout(900);
  }
  if (page.url().includes('/auth/stay-signed-in')) {
    await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}), page.click('form:has(input[name="stay"][value="yes"]) button[type="submit"]')]);
    await page.waitForTimeout(700);
  }
}

/* One tab's card against what it holds, in page coordinates. */
const measure = (page, tab) => page.evaluate((tab) => {
  const panel = document.querySelector(`[data-clients-panel="${tab}"]`);
  if (!panel) return null;
  const card = panel.getBoundingClientRect();
  let lowest = card.top;
  let lowestName = '';
  panel.querySelectorAll('*').forEach((el) => {
    const b = el.getBoundingClientRect();
    if (!b.height || getComputedStyle(el).position === 'fixed') return;
    if (b.bottom > lowest) { lowest = b.bottom; lowestName = (el.className || el.tagName).toString().slice(0, 60); }
  });
  const scroller = panel.parentElement;
  const wash = panel.querySelector('.tma-cip-thread');
  const washBox = wash && wash.getBoundingClientRect();
  const form = panel.querySelector('[data-cip-thread-form]');

  return {
    height: Math.round(card.height),
    spill: Math.round(lowest - card.bottom),
    lowestName,
    available: scroller.clientHeight,
    scrolls: scroller.scrollHeight > scroller.clientHeight + 1,
    background: getComputedStyle(panel).backgroundColor,
    washInside: washBox ? (washBox.left >= card.left && washBox.right <= card.right && washBox.bottom <= card.bottom) : null,
    formInside: form ? form.getBoundingClientRect().bottom <= card.bottom : null,
    ownScroller: [...panel.querySelectorAll('*')].some((el) => /(auto|scroll)/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight + 1),
  };
}, tab);

/* Every incoming bubble that carries its sender's photo, and what hangs under it. */
const faces = (page) => page.evaluate(() => {
  const rows = [...document.querySelectorAll('.tma-cip-thread .tma-dash__messages-bubble-row--in')];

  return rows.map((row) => {
    const avatar = row.querySelector('.tma-dash__messages-bubble-avatar:not(.tma-dash__messages-bubble-avatar--blank)');
    const bubble = row.querySelector('.tma-dash__messages-bubble');
    if (!avatar || !bubble) return null;
    const a = avatar.getBoundingClientRect();
    const b = bubble.getBoundingClientRect();
    const reactions = row.querySelector('.tma-dash__messages-reactions');
    const receipt = row.querySelector('.tma-dash__messages-bubble-receipt');
    const under = [reactions, receipt].filter(Boolean).map(el => el.getBoundingClientRect());

    return {
      gap: Math.round(b.bottom - a.bottom),
      reactions: !!reactions,
      counted: !!(reactions && reactions.querySelector('.tma-dash__messages-reaction-count')),
      receipt: !!receipt,
      faces: receipt ? receipt.children.length : 0,
      faceLines: receipt ? new Set([...receipt.children].map(c => Math.round(c.getBoundingClientRect().top))).size : 0,
      // Is everything under the bubble also below the photo, and under the bubble's own edge?
      below: under.every(u => u.top >= a.bottom - 1),
      aligned: under.every(u => u.left >= b.left - 1),
    };
  }).filter(Boolean);
});

async function openTab(page, tab) {
  await page.locator(`[data-clients-tab="${tab}"]`).first().click();
  await page.waitForTimeout(1200);
}

async function run(name, viewport, dark) {
  const phone = viewport.width < 700;
  const ctx = await browser.newContext({ viewport });
  await ctx.addInitScript((dark) => {
    try {
      localStorage.setItem('tma.legalAccepted', '1');
      if (dark) localStorage.setItem('tma.theme', 'dark');
    } catch (e) { /* asked instead */ }
  }, dark);
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));

  try {
    await signIn(page);
    if (dark) {
      // The theme is a setting on the shell; say so directly so this run
      // does not depend on where the toggle keeps it.
      await page.evaluate(() => { document.documentElement.setAttribute('data-theme', 'dark'); const d = document.querySelector('.tma-dash'); if (d) d.setAttribute('data-theme', 'dark'); });
    }
    await page.goto(`${BASE}/citizenship-applications`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector(`tr[data-cip-app="${APP}"], [data-cip-app="${APP}"]`, { timeout: 30000 });
    await page.waitForTimeout(500);
    await page.locator(`[data-cip-app="${APP}"] .tma-cip-table__number`).first().click();
    await page.locator('.tma-dash__cip-strip').first().waitFor({ timeout: 30000 });
    await page.waitForTimeout(1500);
    if (dark) await page.evaluate(() => { document.documentElement.setAttribute('data-theme', 'dark'); const d = document.querySelector('.tma-dash'); if (d) d.setAttribute('data-theme', 'dark'); });

    step(name, 'The Messages card holds the whole thread');
    await openTab(page, 'messages');
    await page.waitForSelector('.tma-cip-thread', { timeout: 15000 });
    await page.waitForTimeout(800);
    const messages = await measure(page, 'messages');
    console.log(`      card ${messages.height}px, window offers ${messages.available}px, lowest content ${messages.spill}px past the card (${messages.lowestName})`);
    // On a phone the whole page scrolls and nothing is fitted to the window.
    check(messages.height > Math.min(messages.available, viewport.height), `the thread is longer than the window (${messages.height}px)`);
    check(messages.spill <= 0, `nothing runs past the card's foot (${messages.spill}px)`);
    check(messages.washInside === true, 'the thread\'s wash sits inside the card');
    check(messages.formInside === true, 'and so does the composer');
    if (SHOTS) {
      await page.evaluate(() => {
        const panel = document.querySelector('[data-clients-panel="messages"]');
        const form = panel.querySelector('[data-cip-thread-form]');
        const sc = panel.parentElement;
        sc.scrollTop += form.getBoundingClientRect().top - sc.getBoundingClientRect().bottom + 140;
      });
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${SHOTS}/messages-tab-${name}.png` });
    }

    step(name, 'A photo meets its bubble, with reactions and readers below it');
    const f = await faces(page);
    const kind = (r) => (r.counted ? 'a counted reaction' : r.reactions ? 'a reaction' : 'no reaction') +
      (r.receipt ? ` and ${r.faces} reader${r.faces === 1 ? '' : 's'} on ${r.faceLines} line${r.faceLines === 1 ? '' : 's'}` : '');
    console.log(`      ${f.map(r => `${kind(r)}: ${r.gap}px`).join(' | ')}`);
    check(f.some(r => !r.reactions && !r.receipt), 'one bubble ends a run with nothing under it');
    check(f.some(r => r.counted && r.faceLines === 1), 'one with a reaction two people gave, drawn with its count, and one reader\'s face');
    check(f.some(r => r.reactions && !r.counted && r.faceLines === 2), 'one with a reaction and two lines of readers\' faces');
    check(f.every(r => r.gap === 2), `every photo's foot is 2px above its bubble's (${f.map(r => r.gap).join(', ')})`);
    check(f.every(r => r.below), 'what hangs under a bubble is below the photo, not beside it');
    check(f.every(r => r.aligned), 'and stays under the bubble');

    step(name, 'Each conversation on the file carries the picture it has in Messages');
    // They were all one chat-bubble glyph, which says "a conversation" and
    // nothing about which. The picture stands where the icon slot would be
    // and not inside it: that slot sizes every image in it to the whole
    // slot, which would blow each face of a group up over the others.
    const threads = await page.evaluate(() => Array.from(document.querySelectorAll('[data-clients-open-thread]')).map((row) => {
      const face = row.querySelector('.tma-dash__messages-row-avatar');
      const box = face ? face.getBoundingClientRect() : null;
      return {
        title: (row.querySelector('.tma-dash__clients-assigned-title') || {}).textContent || '',
        face: !!face,
        group: !!(face && face.classList.contains('tma-dash__messages-row-avatar--group')),
        initials: face ? face.textContent.trim() : '',
        width: box ? Math.round(box.width) : 0,
        height: box ? Math.round(box.height) : 0,
        glyph: !!row.querySelector('.tma-dash__clients-assigned-icon'),
        leftOfTitle: !!(box && box.right <= row.querySelector('.tma-dash__clients-assigned-title').getBoundingClientRect().left),
      };
    }));
    console.log(`      ${threads.map(t => `${t.title}: ${t.group ? 'group' : t.initials || 'photo'} ${t.width}x${t.height}`).join(' | ')}`);
    check(threads.length === 2, `both conversations are listed (${threads.length})`);
    check(threads.every(t => t.face && !t.glyph), 'each has a picture and none has the chat glyph');
    check(threads.every(t => t.width === 40 && t.height === 40), 'at the size the other rows on this page use');
    check(threads.every(t => t.leftOfTitle), 'beside its name, not over it');
    const direct = threads.find(t => t.title === 'Tessa Officer');
    const group = threads.find(t => t.title === 'Calder file');
    check(!!direct && !direct.group && direct.initials === 'TO', 'the one with a colleague is her initials, having no photo');
    check(!!group && group.group, 'the group is its members\' faces');

    step(name, 'Activity is held by its card too');
    await openTab(page, 'activity');
    /*
     * A new file's trail is a few lines, so the window is made short enough
     * that even those do not fit: the card has to be taller than the height
     * on offer, which is what it could not be.
     */
    const squeezed = !phone;
    if (squeezed) await page.setViewportSize({ width: viewport.width, height: 400 });
    await page.waitForTimeout(400);
    const activity = await measure(page, 'activity');
    console.log(`      card ${activity.height}px, window offers ${activity.available}px, ${activity.spill}px past`);
    if (squeezed) check(activity.height > activity.available, `the trail is longer than the height on offer (${activity.height}px of ${activity.available}px)`);
    check(activity.spill <= 0, `nothing runs past the Activity card (${activity.spill}px)`);
    if (squeezed) await page.setViewportSize(viewport);
    await page.waitForTimeout(300);

    step(name, 'Short tabs still fill the height, and Documents still scrolls inside its own');
    for (const tab of ['assigned', 'access']) {
      await openTab(page, tab);
      const m = await measure(page, tab);
      check(m.spill <= 0 && m.height >= m.available - 1, `${tab}: the card fills the ${m.available}px on offer (${m.height}px) and holds what is in it`);
    }
    await openTab(page, 'folders');
    const folders = await measure(page, 'folders');
    check(folders.height <= folders.available + 1 && !folders.scrolls, `Documents is still fitted to the window (${folders.height}px of ${folders.available}px)`);

    check(pageErrors.length === 0, `no page errors (${pageErrors.slice(0, 2).join(' / ') || 'none'})`);
  } finally {
    await ctx.close();
  }
}

try {
  await run('desktop', { width: 1349, height: 640 }, false);
  await run('desktop-dark', { width: 1349, height: 640 }, true);
  await run('phone', { width: 390, height: 780 }, false);
} finally {
  await browser.close();
}

console.log(failures.length ? `\nFAILED (${failures.length})\n - ${failures.join('\n - ')}` : '\nAll Messages tab checks passed.');
process.exit(failures.length ? 1 : 0);
