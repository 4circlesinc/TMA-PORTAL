/**
 * Mobile Messages inbox: conversation rows must keep their height.
 *
 * The list body is a flex column. Mobile rows sit in a swipe wrap with
 * overflow: hidden, which drops the flex automatic minimum size to 0. Without
 * flex-shrink: 0 the rows collapse while the Favorites / Chats group labels
 * (no overflow clip) stay visible — matching the blank inbox on phones.
 *
 * The fixture loads live dashboard.css at a phone viewport and fills the list
 * past the fold so flex pressure is real. No portal seed required.
 *
 *   node tests/Browser/messaging-mobile-list.mjs [screenshot.png]
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const CSS = readFileSync(join(ROOT, 'public/css/dashboard.css'), 'utf8');

function swipeRow(id, name, preview, time, extraAvatarClass) {
  const avatarClass =
    'tma-dash__messages-row-avatar tma-dash__messages-row-avatar--initial' +
    (extraAvatarClass ? ' ' + extraAvatarClass : '');
  const initial = name.trim().charAt(0) || '?';
  return (
    `<div class="tma-dash__messages-row-swipe" data-messages-row-swipe="${id}">` +
    `<div class="tma-dash__messages-row-swipe-actions tma-dash__messages-row-swipe-actions--left" aria-hidden="true"></div>` +
    `<div class="tma-dash__messages-row-swipe-actions tma-dash__messages-row-swipe-actions--right" aria-hidden="true"></div>` +
    `<div class="tma-dash__messages-row-swipe-track" data-messages-row-swipe-track>` +
    `<div class="tma-dash__messages-row" data-messages-row="${id}" role="button">` +
    `<span class="${avatarClass}">${initial}</span>` +
    `<span class="tma-dash__messages-row-text">` +
    `<span class="tma-dash__messages-row-name"><span class="tma-dash__messages-row-name-text">${name}</span></span>` +
    `<span class="tma-dash__messages-row-preview">${preview}</span>` +
    `</span>` +
    `<span class="tma-dash__messages-row-time">${time}</span>` +
    `<span class="tma-dash__messages-row-meta" aria-hidden="true"></span>` +
    `</div></div></div>`
  );
}

// Enough rows that natural height exceeds the phone list body — that is when
 // overflow:hidden flex items actually collapse without flex-shrink: 0.
const chatRows = Array.from({ length: 18 }, (_, i) =>
  swipeRow(
    `chat-${i + 1}`,
    `Contact ${i + 1}`,
    `Preview for conversation ${i + 1}`,
    i === 0 ? 'Yesterday' : `Mon`,
    i % 2 ? 'tma-dash__messages-row-avatar--green' : ''
  )
).join('');

const HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>${CSS}</style>
  <style>
    :root {
      --space-4: 4px; --space-8: 8px; --space-12: 12px; --space-16: 16px;
      --text-size-12: 12px; --text-size-14: 14px; --text-lh-14: 20px;
      --font-weight-semibold: 600;
      --color-white: #fff; --color-bg-card: #fff;
      --color-text-primary: #111; --color-text-secondary: #666;
      --color-overlay-4: rgba(0,0,0,.04);
      --radius-8: 8px; --radius-16: 16px;
      --dash-mobile-gutter: 16px; --dash-tabbar-clearance: 72px;
      --dash-mobile-header-h: 56px;
    }
    html, body { margin: 0; height: 100%; }
    body { font: 14px/1.4 system-ui, sans-serif; }
  </style>
</head>
<body>
  <div class="tma-dash tma-dash--messages tma-dash--messages-mobile" style="height:100vh;display:flex;flex-direction:column;">
    <div class="tma-dash__main" style="flex:1;min-height:0;display:flex;flex-direction:column;">
      <div class="tma-dash__view" data-view="messages" style="flex:1;min-height:0;display:flex;flex-direction:column;">
        <div class="tma-dash__messages" style="flex:1;min-height:0;">
          <div class="tma-dash__messages-layout tma-dash__messages-layout--mobile" style="flex:1;min-height:0;display:flex;flex-direction:column;height:100%;">
            <div class="tma-dash__messages-list" style="flex:1;min-height:0;display:flex;flex-direction:column;height:100%;">
              <div class="tma-dash__messages-list-mobile-head">
                <div class="tma-dash__messages-search"><span class="tma-dash__messages-search-text">Search</span></div>
              </div>
              <div class="tma-dash__messages-list-body" data-messages-list-body>
                <div class="tma-dash__messages-list-group">Favorites</div>
                ${swipeRow('fav-1', 'Ana Ruiz', 'Pinned conversation preview', '2:14 PM', 'tma-dash__messages-row-avatar--blue')}
                <div class="tma-dash__messages-list-group">Chats</div>
                ${chatRows}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</body>
</html>`;

const failures = [];
const check = (ok, msg) => {
  console.log(`  ${ok ? '✓' : '✗'} ${msg}`);
  if (!ok) failures.push(msg);
};

const server = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(HTML);
});

await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
const { port } = server.address();
const url = `http://127.0.0.1:${port}/`;

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});

try {
  await page.goto(url, { waitUntil: 'networkidle' });

  const metrics = await page.evaluate(() => {
    const body = document.querySelector('[data-messages-list-body]');
    const groups = [...document.querySelectorAll('.tma-dash__messages-list-group')].map((el) => ({
      text: el.textContent.trim(),
      height: el.getBoundingClientRect().height,
    }));
    const rows = [...document.querySelectorAll('[data-messages-row-swipe]')].map((el) => {
      const box = el.getBoundingClientRect();
      const name = el.querySelector('.tma-dash__messages-row-name-text')?.textContent?.trim() || '';
      const shrink = getComputedStyle(el).flexShrink;
      const overflow = getComputedStyle(el).overflow;
      return {
        name,
        height: box.height,
        width: box.width,
        shrink,
        overflow,
        visible: box.height > 1 && box.width > 1,
      };
    });
    const collapsed = rows.filter((r) => r.height < 2).length;
    const short = rows.filter((r) => r.height > 1 && r.height < 40).length;
    return {
      bodyHeight: body.getBoundingClientRect().height,
      scrollHeight: body.scrollHeight,
      clientHeight: body.clientHeight,
      groups,
      rowCount: rows.length,
      firstRows: rows.slice(0, 4),
      minHeight: Math.min(...rows.map((r) => r.height)),
      maxHeight: Math.max(...rows.map((r) => r.height)),
      collapsed,
      short,
      // Labels alone with collapsed rows is the reported phone bug.
      labelsOnly: groups.every((g) => g.height > 8) && rows.every((r) => r.height < 2),
      allShrinkZero: rows.every((r) => r.shrink === '0'),
    };
  });

  console.log('Mobile messages list fixture @ 390×844');
  console.log(JSON.stringify(metrics, null, 2));

  check(metrics.bodyHeight > 200, `list body has usable height (${Math.round(metrics.bodyHeight)}px)`);
  check(
    metrics.scrollHeight > metrics.clientHeight + 40,
    `list content overflows so flex would otherwise compress rows (${metrics.scrollHeight} > ${metrics.clientHeight})`
  );
  check(metrics.groups.length === 2, `both group labels render (${metrics.groups.length})`);
  check(metrics.rowCount >= 10, `enough swipe rows to stress the layout (${metrics.rowCount})`);
  check(!metrics.labelsOnly, 'rows are not collapsed under visible Favorites/Chats labels');
  check(metrics.collapsed === 0, `no rows collapsed to ~0px (got ${metrics.collapsed})`);
  check(metrics.short === 0, `no rows crushed below 40px (got ${metrics.short})`);
  check(metrics.allShrinkZero, 'every swipe row has flex-shrink: 0');
  check(metrics.minHeight >= 48, `shortest row is ${Math.round(metrics.minHeight)}px (≥ 48)`);

  const shot = process.argv[2];
  if (shot) await page.screenshot({ path: shot, fullPage: false });
} finally {
  await browser.close();
  server.close();
}

if (failures.length) {
  console.error('\nFAILED:');
  failures.forEach((f) => console.error(' -', f));
  process.exit(1);
}

console.log('\nAll checks passed.');
