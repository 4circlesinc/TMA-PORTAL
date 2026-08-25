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

      /*
       * The auth shell. Not the portal's — these pages are a different tree
       * (.tma-auth, not .tma-dash) served by Blade, and they were left out of
       * the bar's shrink for every release it has existed: body padding pushed
       * them down, .tma-auth stayed min-height: 100vh, and every one of them
       * scrolled by exactly the bar's height in the app while fitting perfectly
       * in a browser.
       *
       * Only the three class names that carry the height are reproduced here —
       * the real auth.css does the rest, so the numbers under test are the
       * shipped ones and not a copy that can drift.
       */
      if (url === '/auth') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<!doctype html><html><head><meta charset="utf-8">
          <link rel="stylesheet" href="/css/tokens.css">
          <link rel="stylesheet" href="/css/theme.css">
          <link rel="stylesheet" href="/css/auth.css">
          <link rel="stylesheet" href="/css/auth-flow.css">
          <style>html, body { margin: 0; min-height: 100%; }</style>
        </head><body>
          <main class="tma-auth">
            <div class="tma-auth__body">
              <section class="tma-auth__card tma-auth__card--tall"><h1 class="tma-auth__title">Sign in</h1></section>
            </div>
            <p class="tma-auth__copyright">&copy; TM ANTOINE Advisory</p>
          </main>
        </body></html>`);
        return;
      }

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
   * The bar has to move the window. The injected strip is only a left-hand
   * stub beside the shell; the rest of the blue is the portal header, and
   * Chromium hit-tests the node under the cursor, not its ancestor. So the
   * header cells, the heading and the empty gaps must be drag, and every
   * control that still needs a click must opt out.
   */
  const drag = await win.webContents.executeJavaScript(`
    new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve((() => {
      const region = (sel) => {
        const el = document.querySelector(sel);
        return el ? getComputedStyle(el).getPropertyValue('-webkit-app-region') : null;
      };
      return {
        bar: region('#tma-desktop-titlebar'),
        title: region('#tma-desktop-titlebar .tma-tb-title'),
        sep: region('#tma-desktop-titlebar .tma-tb-sep'),
        nav: region('#tma-desktop-titlebar .tma-tb-nav'),
        back: region('[data-tb="back"]'),
        header: region('.tma-dash__header'),
        headerLeft: region('.tma-dash__header-left'),
        headerCenter: region('.tma-dash__header-center'),
        headerRight: region('.tma-dash__header-right'),
        search: region('.tma-dash__search'),
        theme: region('[data-action="toggle-theme"]'),
        presence: region('[data-presence-header]'),
        icons: region('.tma-dash__header-icons'),
      };
    })()))))
  `, true);

  check('drag: the titlebar is a drag handle', drag.bar, 'drag');
  check('drag: the heading is a drag handle', drag.title, 'drag');
  check('drag: the separator is a drag handle', drag.sep, 'drag');
  check('drag: the nav cluster is not a drag handle', drag.nav, 'no-drag');
  check('drag: a nav button is not a drag handle', drag.back, 'no-drag');
  check('drag: the portal header is a drag handle', drag.header, 'drag');
  check('drag: the header left cell is a drag handle', drag.headerLeft, 'drag');
  check('drag: the header centre cell is a drag handle', drag.headerCenter, 'drag');
  check('drag: the header right cell is a drag handle', drag.headerRight, 'drag');
  check('drag: search still receives clicks', drag.search, 'no-drag');
  check('drag: the theme button still receives clicks', drag.theme, 'no-drag');
  check('drag: the presence pill still receives clicks', drag.presence, 'no-drag');
  check('drag: the icon cluster still receives clicks', drag.icons, 'no-drag');

  /* ── the auth pages ──────────────────────────────────────────────────────
   *
   * The bug: .tma-dash is shrunk by the bar above and .tma-auth was not, so
   * sign in, register, forgot password and the rest each stood exactly one bar
   * taller than the window. Every one of them fit its viewport in a browser and
   * scrolled in the app, which is why it survived so long — it is invisible
   * anywhere but inside the shell.
   *
   * Both halves are checked. The shrink is only half a fix on its own: the card
   * sizes itself against calc(100vh - var(--auth-chrome)), so with the bar left
   * out of that budget a card that thinks it has the whole window pushes the
   * page past the bottom again.
   */
  const authWin = new BrowserWindow({
    width: 1400, height: 900, show: false, ...titlebar.windowOptions(),
  });

  await authWin.loadURL(`http://127.0.0.1:${port}/auth`);

  const measureAuth = () => authWin.webContents.executeJavaScript(`
    new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve((() => {
      const doc = document.scrollingElement;
      const auth = document.querySelector('.tma-auth');
      const chrome = getComputedStyle(auth).getPropertyValue('--auth-chrome').trim();

      return {
        overflow: doc.scrollHeight - doc.clientHeight,
        // Resolved, not the calc() as written, so this reads the number the
        // card is actually laid out against.
        chrome: Math.round(parseFloat(getComputedStyle(auth).getPropertyValue('--auth-bar'))),
        chromeRaw: chrome,
      };
    })()))))
  `, true);

  /*
   * First prove the fixture can still fail. The old behaviour was the body
   * padding with nothing shrinking .tma-auth — so injecting only that half has
   * to reproduce the exact overflow this test exists to stop, or the checks
   * below are passing on a page that was never at risk.
   */
  await authWin.webContents.insertCSS(`body { padding-top: ${titlebar.HEIGHT}px !important; }`);
  const authBefore = await measureAuth();
  check('auth: the padding alone still scrolls it by a bar', authBefore.overflow, titlebar.HEIGHT);

  await titlebar.apply(authWin.webContents);

  const authAfter = await measureAuth();
  check('auth: page does not scroll', authAfter.overflow, 0);
  check('auth: the bar is added to the card budget', authAfter.chrome, titlebar.HEIGHT);
  check('auth: and the budget is still composed, not overridden',
    authAfter.chromeRaw.includes('var(--auth-bar)') || authAfter.chromeRaw.includes('calc'), true);

  const authDrag = await authWin.webContents.executeJavaScript(`
    (() => {
      const region = (sel) => {
        const el = document.querySelector(sel);
        return el ? getComputedStyle(el).getPropertyValue('-webkit-app-region') : null;
      };
      return {
        bar: region('#tma-desktop-titlebar'),
        title: region('#tma-desktop-titlebar .tma-tb-title'),
        nav: region('#tma-desktop-titlebar .tma-tb-nav'),
      };
    })()
  `, true);

  check('auth: the titlebar is a drag handle', authDrag.bar, 'drag');
  check('auth: the heading is a drag handle', authDrag.title, 'drag');
  check('auth: the nav cluster is not a drag handle', authDrag.nav, 'no-drag');

  authWin.destroy();

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
        headerDrag: getComputedStyle(document.querySelector('.tma-dash__header'))
          .getPropertyValue('-webkit-app-region'),
        searchDrag: getComputedStyle(document.querySelector('.tma-dash__search'))
          .getPropertyValue('-webkit-app-region'),
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
  check('windows: the header is a drag handle', windows.headerDrag, 'drag');
  check('windows: search still receives clicks', windows.searchDrag, 'no-drag');

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
        // Must not keep the mobile header clearance (~68px) — body padding
        // already clears the title bar. A small content inset (16px) is fine
        // for Dashboard; Email zeros it separately.
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
  check('narrow: no mobile header clearance under the bar', narrow.mainPadTop <= 16, true);
  check('narrow: keeps a small content inset', narrow.mainPadTop, 16);
  check('narrow: the right-panel toggle still clears the caption buttons',
    narrow.rightbarRight <= NARROW - winMetrics.caption, true);
  check('narrow: page does not scroll', narrow.overflow, 0);

  console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');

  server.close();
  app.exit(failures ? 1 : 0);
});
