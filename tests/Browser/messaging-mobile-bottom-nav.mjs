/**
 * Mobile Messages: the portal tab bar yields to the Messages section bar.
 *
 * On the phone inbox, Chats / Calls / Media / Settings must be the dock at the
 * bottom of the screen. The Home / Mail / Profile tab bar stays hidden until
 * the reader leaves Messages (or opens a thread, which already hides it).
 *
 *   node tests/Browser/messaging-mobile-bottom-nav.mjs [screenshot.png]
 *   TMA_BROWSER=webkit node tests/Browser/messaging-mobile-bottom-nav.mjs
 */
import { chromium, webkit } from 'playwright';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const CSS = readFileSync(join(ROOT, 'public/css/dashboard.css'), 'utf8');

const HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>${CSS}</style>
  <style>
    :root {
      --space-4: 4px; --space-6: 6px; --space-8: 8px; --space-12: 12px; --space-16: 16px;
      --text-size-12: 12px; --text-size-14: 14px; --text-lh-14: 20px;
      --radius-8: 8px; --radius-12: 12px; --radius-16: 16px; --radius-20: 20px;
      --color-white: #fff; --color-bg-card: #fff;
      --color-text-primary: #111; --color-text-secondary: #666;
      --color-overlay-4: rgba(0,0,0,.04); --color-overlay-8: rgba(0,0,0,.08);
      --color-hover: rgba(0,0,0,.06); --color-primary: #03a5e9;
      --dash-mobile-gutter: 16px; --dash-mobile-header-h: 56px;
      --dash-tabbar-block-h: 68px; --dash-tabbar-clearance: 76px;
    }
    html, body { margin: 0; height: 100%; }
    body { font: 14px/1.4 system-ui, sans-serif; }
    .tma-dash__tabbar { display: flex; }
  </style>
</head>
<body>
  <div class="tma-dash tma-dash--messages tma-dash--messages-mobile" style="height:100vh;display:flex;flex-direction:column;">
    <header class="tma-dash__header" style="height:56px;flex:none;"></header>
    <div class="tma-dash__main" style="flex:1;min-height:0;display:flex;flex-direction:column;">
      <div class="tma-dash__view" data-view="messages" style="flex:1;min-height:0;display:flex;flex-direction:column;">
        <div class="tma-dash__messages" style="flex:1;min-height:0;">
          <div class="tma-dash__messages-layout tma-dash__messages-layout--mobile" style="flex:1;min-height:0;display:flex;flex-direction:column;height:100%;">
            <div class="tma-dash__messages-list" style="flex:1;min-height:0;display:flex;flex-direction:column;">
              <div class="tma-dash__messages-list-mobile-head">
                <div class="tma-dash__messages-search"><span class="tma-dash__messages-search-text">Search</span></div>
              </div>
              <div class="tma-dash__messages-list-body" data-messages-list-body>
                <div class="tma-dash__messages-list-group">Chats</div>
                <div class="tma-dash__messages-row-swipe" data-messages-row-swipe="1">
                  <div class="tma-dash__messages-row-swipe-track">
                    <div class="tma-dash__messages-row" data-messages-row="1" role="button">
                      <span class="tma-dash__messages-row-avatar tma-dash__messages-row-avatar--initial">A</span>
                      <span class="tma-dash__messages-row-text">
                        <span class="tma-dash__messages-row-name"><span class="tma-dash__messages-row-name-text">Ana Ruiz</span></span>
                        <span class="tma-dash__messages-row-preview">Hello</span>
                      </span>
                      <span class="tma-dash__messages-row-time">2:14 PM</span>
                      <span class="tma-dash__messages-row-meta" aria-hidden="true"></span>
                    </div>
                  </div>
                </div>
              </div>
              <div class="tma-dash__messages-fab-slot">
                <button type="button" class="tma-dash__messages-fab" data-messages-compose aria-label="New message">+</button>
              </div>
              <div class="tma-dash__messages-list-foot" role="tablist" aria-label="Messages sections">
                <button type="button" class="tma-dash__messages-nav-btn is-active" data-messages-nav-chats aria-current="page">
                  <span class="tma-dash__messages-nav-icon"><span aria-hidden="true">💬</span></span>
                  <span class="tma-dash__messages-nav-label">Chats</span>
                </button>
                <button type="button" class="tma-dash__messages-nav-btn" data-messages-nav-calls>
                  <span class="tma-dash__messages-nav-icon"><span aria-hidden="true">📞</span></span>
                  <span class="tma-dash__messages-nav-label">Calls</span>
                </button>
                <button type="button" class="tma-dash__messages-nav-btn" data-messages-media>
                  <span class="tma-dash__messages-nav-icon"><span aria-hidden="true">🖼</span></span>
                  <span class="tma-dash__messages-nav-label">Media</span>
                </button>
                <button type="button" class="tma-dash__messages-nav-btn" data-messages-settings>
                  <span class="tma-dash__messages-nav-icon"><span aria-hidden="true">⚙</span></span>
                  <span class="tma-dash__messages-nav-label">Settings</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    <nav class="tma-dash__tabbar" aria-label="Portal">
      <div class="tma-dash__tabbar-row">
        <button type="button" class="tma-dash__tab-btn"><span class="tma-dash__tab-btn-icon">H</span></button>
        <button type="button" class="tma-dash__tab-btn"><span class="tma-dash__tab-btn-icon">P</span></button>
        <button type="button" class="tma-dash__tab-btn"><span class="tma-dash__tab-btn-icon">M</span></button>
        <button type="button" class="tma-dash__tab-btn tma-dash__tab-btn--active"><span class="tma-dash__tab-btn-icon">C</span></button>
        <button type="button" class="tma-dash__tab-btn"><span class="tma-dash__tab-btn-icon">U</span></button>
      </div>
    </nav>
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

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const { port } = server.address();
const engine = process.env.TMA_BROWSER === 'webkit' ? webkit : chromium;
const browser = await engine.launch();
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});

try {
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });

  const metrics = await page.evaluate(() => {
    const foot = document.querySelector('.tma-dash__messages-list-foot');
    const tabbar = document.querySelector('.tma-dash__tabbar');
    const fab = document.querySelector('.tma-dash__messages-fab');
    const row = document.querySelector('[data-messages-row]');
    const footBox = foot.getBoundingClientRect();
    const fabBox = fab.getBoundingClientRect();
    const rowBox = row.getBoundingClientRect();
    const vh = window.innerHeight;
    const footStyle = getComputedStyle(foot);
    const tabStyle = getComputedStyle(tabbar);
    return {
      tabbarDisplay: tabStyle.display,
      footPosition: footStyle.position,
      footVisible: footBox.height > 40 && footStyle.display !== 'none',
      footBottom: Math.round(footBox.bottom),
      footTop: Math.round(footBox.top),
      viewport: vh,
      labels: [...foot.querySelectorAll('.tma-dash__messages-nav-label')].map((n) => n.textContent.trim()),
      rowVisible: rowBox.height >= 48 && rowBox.bottom < footBox.top + 1,
      fabAboveFoot: fabBox.bottom <= footBox.top + 1,
      fabBottom: Math.round(fabBox.bottom),
    };
  });

  console.log('Mobile Messages bottom nav @ 390×844');
  console.log(JSON.stringify(metrics, null, 2));

  check(metrics.tabbarDisplay === 'none', `portal tab bar is hidden (got ${metrics.tabbarDisplay})`);
  check(metrics.footPosition === 'fixed', `Messages foot is fixed to the screen (got ${metrics.footPosition})`);
  check(metrics.footVisible, 'Messages foot is visible');
  check(
    Math.abs(metrics.footBottom - metrics.viewport) <= 2,
    `Messages foot sits on the screen bottom (${metrics.footBottom} vs ${metrics.viewport})`
  );
  check(
    metrics.labels.join(',') === 'Chats,Calls,Media,Settings',
    `Messages dock shows section labels (${metrics.labels.join(', ')})`
  );
  check(metrics.rowVisible, 'conversation rows sit above the Messages foot');
  check(metrics.fabAboveFoot, 'compose button sits above the Messages foot');

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
