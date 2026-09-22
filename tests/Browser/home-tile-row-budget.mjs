/*
 * Every home tile must show whole rows, and must not leave room for a row it
 * refuses to draw.
 *
 * Two failures, and the tile looks the same in both: a row sliced through its
 * avatar at the card's edge, or a band of blank card under the last row with
 * more rows waiting behind it. The second is what this was written for —
 * Recent Email showed four rows and cut the fifth, Recent Files hid a whole
 * 58px row under 70px of empty card, because the body's budget was a
 * percentage of the tile (the whole card, padding and head included) with a
 * hand-written chrome subtracted from it. The masonry now measures the body
 * and publishes --tma-tile-body-space; see publishBodySpace in
 * public/js/portal-home.js.
 *
 * Lists are overfilled in the page rather than in the database, so this needs
 * no seeding. A tile that already has a row is filled with clones of it, so
 * what is measured is the row the portal ships; an empty tile is given the
 * markup the populated tile would have had.
 *
 * Run against the Docker stack (whose row heights are fluid, so check more
 * than one width — 1024 is a breakpoint and the rows change size across it):
 *
 *   CHROME_BIN="…/Google Chrome for Testing" node tests/Browser/home-tile-row-budget.mjs
 *   W=1024 H=900 node tests/Browser/home-tile-row-budget.mjs
 *
 * Exits non-zero naming the tile that cuts a row or wastes a row's worth of
 * space.
 */
import { chromium } from 'playwright';

const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8001';
const EMAIL = process.env.TMA_STAFF_EMAIL || 'harness@localhost';
const W = Number(process.env.W || 1500);
const H = Number(process.env.H || 950);

const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN });
const context = await browser.newContext({ viewport: { width: W, height: H } });
const page = await context.newPage();

async function signIn() {
  await page.goto(`${BASE}/auth/login`, { waitUntil: 'domcontentloaded' });
  const byEmail = page.locator('text=Sign in with Email');
  if (await byEmail.count()) await byEmail.first().click().catch(() => {});
  await page.waitForSelector('input[name="email"]', { state: 'visible', timeout: 8000 });
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', 'password12345');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}),
    page.click('button[type="submit"]:visible'),
  ]);
  await page.waitForTimeout(1000);
  if (page.url().includes('/auth/login-code')) {
    const { execSync } = await import('node:child_process');
    await page.waitForTimeout(2500);
    const logs = execSync('docker compose logs --since 3m --no-log-prefix app 2>/dev/null | tail -400', {
      shell: '/bin/zsh', maxBuffer: 64e6,
    }).toString();
    const codes = [...logs.matchAll(/\b(\d{6})\b/g)].map((m) => m[1]).filter((c) => c !== '000000');
    const code = codes[codes.length - 1];
    if (!code) throw new Error('no sign-in code in container logs');
    const trust = page.locator('input[type="checkbox"]');
    if (await trust.count()) await trust.first().check().catch(() => {});
    const box = page.locator('[data-otp-box], input[autocomplete="one-time-code"]:visible, input[inputmode="numeric"]:visible').first();
    if (await box.count()) await box.click().catch(() => {});
    await page.keyboard.type(code, { delay: 60 });
    await page.waitForTimeout(400);
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}),
      page.click('button[type="submit"]:visible'),
    ]);
    await page.waitForTimeout(1200);
  }
  if (page.url().includes('/auth/stay-signed-in')) {
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}),
      page.click('button[type="submit"]:visible'),
    ]);
    await page.waitForTimeout(600);
  }
  if (/\/auth\/(login|login-code)/.test(page.url())) throw new Error('login failed: ' + page.url());
}

await signIn();
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-tile-id]', { timeout: 30000 });
await page.waitForTimeout(6000);
await page.mouse.move(1200, 700);
await page.waitForTimeout(500);

/* Overfill every list. A tile that already has a row is filled with clones of
   it; an empty one gets the markup the portal itself builds (copied from
   renderEmailPanel / the work and chat panels in portal-home.js), so the row
   measured is the row that ships — including the email row's third line, the
   snippet, which is what makes it a three-line row. */
await page.evaluate(() => {
  const AVATAR =
    'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="32" height="32"%3E%3C/svg%3E';
  const TEMPLATES = {
    'tma-portal-email-row':
      '<button type="button" class="tma-portal-email-row">' +
      `<img class="tma-portal-email-row__avatar" src="${AVATAR}" alt="" width="32" height="32">` +
      '<span class="tma-portal-email-row__meta"><span class="tma-portal-email-row__top">' +
      '<span class="tma-portal-email-row__sender">Maggie Williams | Global Citizen Solutions</span>' +
      '<span class="tma-portal-email-row__time">Sep 21</span></span>' +
      '<span class="tma-portal-email-row__subject">Re: New Portal - Queries Before GCS Activation</span>' +
      '<span class="tma-portal-email-row__snippet">Dear Cindy, Following up here, are you available this week</span>' +
      '</span></button>',
    'tma-portal-chat-row':
      '<button type="button" class="tma-portal-chat-row">' +
      `<span class="tma-portal-chat-row__avatar"><img src="${AVATAR}" alt="" width="32" height="32"></span>` +
      '<span class="tma-portal-chat-row__meta"><span class="tma-portal-chat-row__top">' +
      '<span class="tma-portal-chat-row__name">Li Wei</span>' +
      '<span class="tma-portal-chat-row__time">09:14</span></span>' +
      '<span class="tma-portal-chat-row__preview">Sent the papers over</span>' +
      '</span></button>',
    'tma-portal-request-row':
      '<button type="button" class="tma-portal-request-row">' +
      `<span class="tma-portal-request-row__avatar"><img src="${AVATAR}" alt="" width="32" height="32"></span>` +
      '<span class="tma-portal-request-row__meta"><span class="tma-portal-request-row__top">' +
      '<span class="tma-portal-request-row__who">Birth certificate</span>' +
      '<span class="tma-portal-request-row__time">2h</span></span>' +
      '<span class="tma-portal-request-row__headline">Awaiting upload</span>' +
      '<span class="tma-portal-request-row__file">Clients / Chen Wei</span>' +
      '</span></button>',
    'tma-portal-file-row':
      '<button type="button" class="tma-portal-file-row">' +
      '<span style="width:24px;height:24px;display:inline-block"></span>' +
      '<span class="tma-portal-file-row__meta">' +
      '<span class="tma-portal-file-row__name">Engagement letter.pdf</span>' +
      '<span class="tma-portal-file-row__path">Clients / Chen Wei</span>' +
      '</span></button>',
  };

  const SCROLLERS = [
    ['recentFiles', '.tma-portal-panel__body', 'tma-portal-file-row'],
    ['favorites', '.tma-portal-panel__body', 'tma-portal-file-row'],
    ['email', '.tma-portal-email-list', 'tma-portal-email-row'],
    ['messages', '.tma-portal-chat-list', 'tma-portal-chat-row'],
    ['requests', '.tma-portal-work-list', 'tma-portal-request-row'],
    ['comments', '.tma-portal-work-list', 'tma-portal-comment-row'],
    ['employees', '.tma-portal-employees--scroll', 'tma-portal-employee'],
  ];

  SCROLLERS.forEach(([id, scrollSel, rowClass]) => {
    const tile = document.querySelector(`[data-tile-id="${id}"]`);
    if (!tile) return;
    let scroller = tile.querySelector(scrollSel);
    // A tile with no data renders a note and no list at all; build the list
    // the populated tile would have had, in the same place.
    if (!scroller && scrollSel.startsWith('.tma-portal-') && !scrollSel.includes('panel__body')) {
      const body = tile.querySelector('.tma-portal-panel__body');
      if (!body) return;
      // The populated tile's body holds the list and nothing else (see
      // renderEmail/renderChat in portal-home.js), so clear the empty
      // state's note and its "Open …" link rather than leaving them to eat
      // height the row budget does not know about.
      body.innerHTML = '';
      scroller = document.createElement('div');
      scroller.className = scrollSel.slice(1);
      body.appendChild(scroller);
    }
    if (!scroller) return;
    const existing = tile.querySelector('.' + rowClass);
    const make = existing
      ? () => existing.cloneNode(true)
      : TEMPLATES[rowClass]
        ? () => {
            const d = document.createElement('div');
            d.innerHTML = TEMPLATES[rowClass];
            return d.firstElementChild;
          }
        : null;
    if (!make) return;
    // An empty tile shows a note instead of rows; take it out first.
    const note = scroller.querySelector('.tma-portal-panel__note');
    if (note) note.remove();
    for (let i = 0; i < 12; i++) scroller.appendChild(make());
  });
});
await page.waitForTimeout(1200);

const out = await page.evaluate(() => {
  const r = (n) => Math.round(n * 100) / 100;
  const SCROLLERS = {
    recentFiles: ['.tma-portal-panel__body', '.tma-portal-file-row', 12],
    favorites: ['.tma-portal-panel__body', '.tma-portal-file-row', 12],
    email: ['.tma-portal-email-list', '.tma-portal-email-row', 0],
    messages: ['.tma-portal-chat-list', '.tma-portal-chat-row', 0],
    requests: ['.tma-portal-work-list', '.tma-portal-request-row', 0],
    comments: ['.tma-portal-work-list', '.tma-portal-comment-row', 0],
    employees: ['.tma-portal-employees--scroll', '.tma-portal-employee', 2],
  };
  const res = [];
  Object.entries(SCROLLERS).forEach(([id, [scrollSel, rowSel, gap]]) => {
    const tile = document.querySelector(`[data-tile-id="${id}"]`);
    if (!tile) return;
    const scroller = tile.querySelector(scrollSel);
    const rows = scroller ? scroller.querySelectorAll(rowSel) : [];
    if (!scroller || !rows.length) return;
    const rowH = rows[0].getBoundingClientRect().height;
    const sb = scroller.getBoundingClientRect();
    const tb = tile.getBoundingClientRect();
    const padBottom = parseFloat(getComputedStyle(tile).paddingBottom) || 0;
    const visible = (sb.height + gap) / (rowH + gap);
    res.push({
      id,
      gap,
      rows: rows.length,
      rowH: r(rowH),
      scrollerH: r(sb.height),
      visibleRows: r(visible),
      // distance from a whole number of rows
      partial: r(Math.abs(visible - Math.round(visible))),
      blankUnder: r(tb.bottom - padBottom - sb.bottom),
      hidden: r(scroller.scrollHeight - scroller.clientHeight),
    });
  });
  return res;
});

console.log(`\nOverfilled board at ${W}x${H}\n`);
let bad = [];
for (const t of out) {
  // Blank space is only a fault when another whole row would have fitted in
  // it. A remainder smaller than a row is arithmetic, not waste.
  const wastes = t.hidden > 1 && t.blankUnder >= t.rowH + t.gap;
  const cuts = t.partial > 0.04;
  if (wastes) bad.push(`${t.id}: ${t.blankUnder}px blank under the list — a whole ${t.rowH}px row would fit — while ${t.hidden}px is hidden`);
  if (cuts) bad.push(`${t.id}: shows ${t.visibleRows} rows — a partial row is cut`);
  console.log(
    `  ${(wastes || cuts) ? 'BAD ' : 'ok  '} ${t.id.padEnd(12)} ${String(t.rows).padStart(2)} rows @ ${String(t.rowH).padStart(6)}` +
      `  scroller ${String(t.scrollerH).padStart(6)}  = ${String(t.visibleRows).padStart(5)} rows` +
      `  blank-under ${String(t.blankUnder).padStart(5)}  hidden ${String(t.hidden).padStart(5)}`,
  );
}
console.log('');
if (bad.length) {
  console.error('Row budget broken:\n  ' + bad.join('\n  ') + '\n');
  await page.screenshot({ path: 'tests/Browser/_scratch-tile-stress.png', fullPage: true });
  await browser.close();
  process.exit(1);
}
console.log('  every list shows whole rows and wastes no space.\n');
await page.screenshot({ path: 'tests/Browser/_scratch-tile-stress.png', fullPage: true });
await browser.close();
