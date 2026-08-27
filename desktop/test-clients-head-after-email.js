/*
 * CIP application identity lives in .tma-dash__main-head. Email collapses that
 * row with inline !important so the mailbox sits flush under the title bar.
 * Leaving visibility / position / flex behind is the identity vanishing in the
 * desktop app: the tabs stay in the page, the name does not.
 *
 * Run: env -u ELECTRON_RUN_AS_NODE electron test-clients-head-after-email.js
 */
const { app, BrowserWindow } = require('electron');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const TYPES = {
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

const HTML = `<!doctype html>
<html><head>
<link rel="stylesheet" href="/css/tokens.css">
<link rel="stylesheet" href="/css/dashboard.css">
</head>
<body>
<div class="tma-dash tma-dash--desktop-bar tma-dash--clients tma-dash--clients-detail">
  <header class="tma-dash__header"></header>
  <main class="tma-dash__main">
    <div class="tma-dash__main-head">
      <div class="tma-dash__main-head-left tma-dash__main-head-left--clients-detail">
        <h1 class="tma-dash__page-title" data-page-title hidden>CIP Applications</h1>
        <div class="tma-dash__clients-detail-head" data-clients-detail-head>
          <div class="tma-dash__clients-profile-toolbar">
            <div class="tma-dash__clients-profile-head">
              <span class="tma-dash__clients-profile-name">Asem Haddad</span>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div class="tma-dash__view" data-view="clients">
      <div class="tma-tab-group">Overview</div>
    </div>
    <div class="tma-dash__view" data-view="email" hidden></div>
  </main>
</div>
</body></html>`;

const HEAD_LOCK_PROPS = [
  'display', 'margin', 'margin-bottom', 'height', 'max-height', 'min-height',
  'padding', 'overflow', 'flex', 'position', 'visibility', 'width',
  'pointer-events',
];

let failures = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: expected ${expected}, got ${actual}`);
}

setTimeout(() => {
  console.log('\nFAILED — timed out');
  app.exit(1);
}, 20000).unref();

app.on('window-all-closed', () => {});

app.whenReady().then(async () => {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    if (url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(HTML);
      return;
    }
    const file = path.join(PUBLIC, url);
    if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(fs.readFileSync(file));
  }).listen(0);

  const win = new BrowserWindow({ width: 1200, height: 800, show: false });
  await win.loadURL(`http://127.0.0.1:${server.address().port}/`);

  const result = await win.webContents.executeJavaScript(`(() => {
    const head = document.querySelector('.tma-dash__main-head');
    const name = document.querySelector('.tma-dash__clients-profile-name');
    const lock = ${JSON.stringify(HEAD_LOCK_PROPS)};

    const measure = () => {
      const hs = getComputedStyle(head);
      const nr = name.getBoundingClientRect();
      return {
        display: hs.display,
        visibility: hs.visibility,
        position: hs.position,
        height: Math.round(nr.height),
        visible: hs.display !== 'none' && hs.visibility !== 'hidden' && nr.height > 8,
      };
    };

    const before = measure();

    head.hidden = true;
    head.setAttribute('hidden', '');
    head.style.setProperty('display', 'none', 'important');
    head.style.setProperty('margin', '0', 'important');
    head.style.setProperty('height', '0', 'important');
    head.style.setProperty('overflow', 'hidden', 'important');
    head.style.setProperty('flex', '0 0 0', 'important');
    head.style.setProperty('position', 'absolute', 'important');
    head.style.setProperty('visibility', 'hidden', 'important');
    const locked = measure();

    // What leaving Email used to do: drop display / height, leave the rest.
    head.hidden = false;
    head.removeAttribute('hidden');
    ['display', 'margin', 'height', 'max-height', 'padding', 'overflow'].forEach((p) => {
      head.style.removeProperty(p);
    });
    const partial = measure();

    lock.forEach((p) => head.style.removeProperty(p));
    const restored = measure();

    return { before, locked, partial, restored };
  })()`);

  check('identity is on screen before any lock', result.before.visible, true);
  check('the mailbox lock hides the identity', result.locked.visible, false);
  check('the old Email leave-behind still hides it', result.partial.visible, false);
  check('clearing the full lock brings the identity back', result.restored.visible, true);
  check('restored name has a height', result.restored.height > 8, true);

  server.close();
  win.close();
  app.exit(failures ? 1 : 0);
});
