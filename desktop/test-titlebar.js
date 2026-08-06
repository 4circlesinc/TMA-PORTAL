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

/*
 * The injected script is JavaScript built inside a template literal, and that
 * has now broken three separate ways: a backticked term closing the string, a
 * singly-escaped regex arriving as plain letters, and a slash-after-asterisk in
 * a comment closing the comment early and turning prose into code. Each one
 * failed silently in the page. Parsing the emitted text catches all three
 * before it ever reaches a window.
 */
function checkEmittedScript() {
  const src = titlebar.script({ canGoBack: true, canGoForward: false });
  try {
    new Function(src);
    check('the injected script parses', true, true);
  } catch (error) {
    check(`the injected script parses (${error.message})`, false, true);
  }
  check('its regex escapes survived the template', src.includes('\\d+'), true);
}

app.whenReady().then(async () => {
  checkEmittedScript();

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
        // Hidden by design now: the bar carries the identity, so the rail's
        // logo is a duplicate. Measured as "not visible" rather than "below".
        logoHidden: !logo || logo.getBoundingClientRect().height === 0,
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
  check('expanded: the rail logo is hidden, not clipped', expanded.logoHidden, true);
  check('expanded: page does not scroll', expanded.overflow, 0);

  await win.webContents.executeJavaScript(
    "document.querySelector('.tma-dash').classList.add('is-sidebar-collapsed')", true,
  );

  const collapsed = await measure();
  check('collapsed: rail really is position:fixed', collapsed.sidebarFixed, true);
  check('collapsed: rail starts below the bar', collapsed.sidebarTop, titlebar.HEIGHT);
  check('collapsed: the rail logo is hidden, not clipped', collapsed.logoHidden, true);
  check('collapsed: page does not scroll', collapsed.overflow, 0);

  /*
   * The Windows layout, measured on whatever this is running on.
   *
   * Windows reserves space at the right of the strip for caption buttons the OS
   * draws itself, and both bugs this catches were that reserve applied in the
   * wrong place: on the narrow strip beside the shell it squeezed the heading to
   * zero width, and on the header it was missing entirely, so the right-panel
   * toggle sat under the close button. Neither is visible on macOS, which
   * reserves nothing — hence a second window with the Windows CSS in it.
   */
  const WIDTH = 1400;
  const winMetrics = titlebar.metrics('win32');

  const w = new BrowserWindow({ width: WIDTH, height: 900, show: false });
  await w.loadURL(`http://127.0.0.1:${port}/`);
  await w.webContents.insertCSS(titlebar.buildCss('win32'));
  await titlebar.refresh(w.webContents);

  const windows = await w.webContents.executeJavaScript(`
    new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve((() => {
      const title = document.querySelector('#tma-desktop-titlebar .tma-tb-title');
      const nav = document.querySelector('#tma-desktop-titlebar .tma-tb-nav');
      const rightbar = document.querySelector('[data-action="toggle-rightbar"]');

      return {
        titleText: (title.textContent || '').trim(),
        titleWidth: Math.round(title.getBoundingClientRect().width),
        navWidth: Math.round(nav.getBoundingClientRect().width),
        rightbarRight: Math.round(rightbar.getBoundingClientRect().right),
        searchCentre: Math.round(
          document.querySelector('.tma-dash__search').getBoundingClientRect().left
          + document.querySelector('.tma-dash__search').getBoundingClientRect().width / 2
        ),
      };
    })()))))
  `, true);

  check('windows: the heading has text', windows.titleText, 'Dashboard');
  // The exact width depends on the string; that it is laid out at all is the point.
  check('windows: the heading is not squeezed to nothing', windows.titleWidth > 40, true);
  // Three 32px buttons and two 2px gaps — unshrunk.
  check('windows: the nav buttons keep their size', windows.navWidth, 100);
  check(
    'windows: the right-panel toggle clears the caption buttons',
    windows.rightbarRight <= WIDTH - winMetrics.caption,
    true,
  );
  // The insets are on the cells, so the search stays on the window's centre.
  check('windows: search is still centred', Math.abs(windows.searchCentre - WIDTH / 2) <= 2, true);

  /*
   * The narrow window, which is the one that shipped looking stripped.
   *
   * Under 1025px the portal switches to its phone layout and hides the search,
   * the activity button and the bell, because on a phone they live in the
   * bottom tab bar. A Windows laptop at 150% scaling puts the *maximised* app
   * inside that band, so the app has to keep its own chrome there. 960 is the
   * window's minWidth — the narrowest this can ever be asked to work.
   */
  const NARROW = 960;
  const n = new BrowserWindow({ width: NARROW, height: 900, show: false });
  await n.loadURL(`http://127.0.0.1:${port}/`);
  await n.webContents.insertCSS(titlebar.buildCss('win32'));
  await titlebar.refresh(n.webContents);

  const narrow = await n.webContents.executeJavaScript(`
    new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve((() => {
      const seen = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      const header = document.querySelector('.tma-dash__header').getBoundingClientRect();
      const rightbar = document.querySelector('[data-action="toggle-rightbar"]').getBoundingClientRect();
      const doc = document.scrollingElement;

      return {
        search:        seen('.tma-dash__search'),
        activities:    seen('[data-action="toggle-activities-popup"]'),
        notifications: seen('[data-action="toggle-notifications-popup"]'),
        title:         seen('.tma-tb-title'),
        back:          seen('[data-tb="back"]'),
        headerTop:     Math.round(header.top),
        headerHeight:  Math.round(header.height),
        rightbarRight: Math.round(rightbar.right),
        // The phone layout reserves a header's height at the top of the
        // scroller because there the header floats over it. Here that is a
        // second empty strip under the bar.
        mainPadTop:    Math.round(parseFloat(getComputedStyle(document.querySelector('.tma-dash__main')).paddingTop)),
        overflow:      doc.scrollHeight - doc.clientHeight,
      };
    })()))))
  `, true);

  check('narrow: the search is there', narrow.search, true);
  check('narrow: the activity button is there', narrow.activities, true);
  check('narrow: the bell is there', narrow.notifications, true);
  check('narrow: the heading is there', narrow.title, true);
  check('narrow: the nav buttons are there', narrow.back, true);
  check('narrow: the header is the bar, not a second row', narrow.headerTop, 0);
  check('narrow: the bar is one bar tall', narrow.headerHeight, titlebar.HEIGHT);
  check('narrow: no empty strip under the bar', narrow.mainPadTop, 0);
  check('narrow: the right-panel toggle still clears the caption buttons',
    narrow.rightbarRight <= NARROW - winMetrics.caption, true);
  check('narrow: page does not scroll', narrow.overflow, 0);

  console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');

  server.close();
  app.exit(failures ? 1 : 0);
});
