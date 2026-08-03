/*
 * Verifies the drawn title bar against the *real* portal shell, without needing
 * a signed-in portal:
 *
 *   resources/views/pages/dashboard.html + public/css -> injected bar -> layout
 *
 * The bug this exists to catch: body padding moves everything in normal flow,
 * but position:fixed anchors to the viewport and ignores it, so the parts of the
 * shell that go fixed end up *underneath* the bar. That shipped once — the
 * collapsed sidebar is fixed at top:0, and its logo is the first thing in it, so
 * the logo went half-missing.
 *
 * Run with: npm run test:titlebar
 */
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');

const titlebar = require('./titlebar');

const ROOT = path.resolve(__dirname, '..');
const SHELL = path.join(ROOT, 'resources/views/pages/dashboard.html');
const PUBLIC = path.join(ROOT, 'public');

const TYPES = {
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};

/** Serves the real shell at / and the real assets from public/. */
function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = decodeURIComponent(req.url.split('?')[0]);

      if (url === '/') {
        // Scripts and the webfont are stripped: what is under test is how the
        // shell's CSS and the injected bar interact, and the portal's own JS
        // would sit there polling /me and redirecting to a login this server
        // does not serve — the page then never finishes loading.
        const html = fs.readFileSync(SHELL, 'utf8')
          .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
          .replace(/<link[^>]+fonts\.googleapis\.com[^>]*>/gi, '');

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
        return;
      }

      const file = path.join(PUBLIC, url);

      // Anything the shell asks for that we do not have is not what is under
      // test; 404 quietly rather than failing the run.
      if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404).end();
        return;
      }

      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
      res.end(fs.readFileSync(file));
    });

    server.listen(0, () => resolve(server));
  });
}

let failures = 0;

function check(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: expected ${expected}, got ${actual}`);
}

// A hang is a failure too, and a headless run has nobody to notice one.
setTimeout(() => {
  console.log('\nFAILED — timed out');
  app.exit(1);
}, 45000).unref();

app.whenReady().then(async () => {
  const server = await serve();
  const { port } = server.address();

  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    show: false,
    ...titlebar.windowOptions(),
  });

  await win.loadURL(`http://127.0.0.1:${port}/`);
  await titlebar.apply(win.webContents);

  // Two frames, so a class just added has actually been laid out. Measuring in
  // the same tick reads stale geometry and reports failures that are not real.
  const measure = () => win.webContents.executeJavaScript(`
    new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve((() => {
      const bar = document.getElementById('tma-desktop-titlebar');
      const sidebar = document.querySelector('.tma-dash__sidebar');
      const logo = document.querySelector('.tma-dash__sidebar-logo');
      const doc = document.scrollingElement;

      return {
        barHeight: bar ? Math.round(bar.getBoundingClientRect().height) : null,
        sidebarFixed: getComputedStyle(sidebar).position === 'fixed',
        sidebarTop: Math.round(sidebar.getBoundingClientRect().top),
        logoTop: Math.round(logo.getBoundingClientRect().top),
        // A page taller than the window means the shrink and the padding
        // disagree, and everything scrolls under the bar.
        overflow: doc.scrollHeight - doc.clientHeight,
      };
    })()))))
  `, true);

  // The rail is only fixed once collapsed, which is what the hover style does
  // at rest — and the state the logo bug appeared in.
  const expanded = await measure();
  check('expanded: bar is the declared height', expanded.barHeight, titlebar.HEIGHT);
  check('expanded: logo sits below the bar', expanded.logoTop >= titlebar.HEIGHT, true);
  check('expanded: page does not scroll', expanded.overflow, 0);

  await win.webContents.executeJavaScript(
    "document.querySelector('.tma-dash').classList.add('is-sidebar-collapsed')", true,
  );

  const collapsed = await measure();
  check('collapsed: rail really is position:fixed', collapsed.sidebarFixed, true);
  check('collapsed: rail starts below the bar', collapsed.sidebarTop, titlebar.HEIGHT);
  check('collapsed: logo is not clipped by the bar', collapsed.logoTop >= titlebar.HEIGHT, true);
  check('collapsed: page does not scroll', collapsed.overflow, 0);

  console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');

  server.close();
  app.exit(failures ? 1 : 0);
});
