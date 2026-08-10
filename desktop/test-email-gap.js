/*
 * Measures the empty band between the desktop title bar and the email toolbar.
 * Run: npm run test:titlebar-style — or:
 *   env -u ELECTRON_RUN_AS_NODE electron test-email-gap.js
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

function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = decodeURIComponent(req.url.split('?')[0]);
      if (url === '/') {
        const html = fs.readFileSync(SHELL, 'utf8')
          .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
          .replace(/<link[^>]+fonts\.googleapis\.com[^>]*>/gi, '');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
        return;
      }
      const file = path.join(PUBLIC, url);
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

setTimeout(() => {
  console.log('FAILED — timed out');
  app.exit(1);
}, 30000).unref();

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

  const result = await win.webContents.executeJavaScript(`
    new Promise((resolve) => {
      const dash = document.querySelector('.tma-dash');
      dash.classList.add('tma-dash--email');
      dash.classList.remove('tma-dash--email-mobile');
      const main = document.querySelector('.tma-dash__main');
      const head = document.querySelector('.tma-dash__main-head');
      if (head) {
        head.hidden = true;
        head.setAttribute('hidden', '');
        head.style.setProperty('display', 'none', 'important');
      }
      let view = main.querySelector('.tma-dash__view[data-view="email"]');
      if (!view) {
        view = document.createElement('div');
        view.className = 'tma-dash__view';
        view.setAttribute('data-view', 'email');
        main.appendChild(view);
      }
      view.hidden = false;
      Array.prototype.forEach.call(main.querySelectorAll('.tma-dash__view'), function (v) {
        if (v !== view) v.hidden = true;
      });
      view.innerHTML =
        '<div class="tma-dash__email"><div class="tma-dash__email-page">' +
        '<div class="tma-dash__toolbar tma-dash__email-toolbar">TOOLBAR</div>' +
        '<div class="tma-dash__email-fit"><div class="tma-dash__email-layout">panes</div></div>' +
        '</div></div>';

      requestAnimationFrame(() => requestAnimationFrame(() => {
        const header = document.querySelector('.tma-dash__header');
        const toolbar = document.querySelector('.tma-dash__email-toolbar');
        const hs = getComputedStyle(header);
        const ms = getComputedStyle(main);
        const rows = getComputedStyle(dash).gridTemplateRows;
        const children = Array.prototype.map.call(main.children, (el) => {
          const r = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          return {
            cls: String(el.className || '').slice(0, 100),
            view: el.getAttribute('data-view'),
            hiddenAttr: !!el.hidden,
            top: Math.round(r.top),
            h: Math.round(r.height),
            display: cs.display,
            visibility: cs.visibility,
            flex: cs.flex,
            mt: cs.marginTop,
            mb: cs.marginBottom,
            pt: cs.paddingTop,
          };
        });
        const toolbarCs = getComputedStyle(toolbar);
        resolve({
          desktopBar: dash.classList.contains('tma-dash--desktop-bar'),
          headerPos: hs.position,
          headerTop: Math.round(header.getBoundingClientRect().top),
          headerBottom: Math.round(header.getBoundingClientRect().bottom),
          headerH: Math.round(header.getBoundingClientRect().height),
          dashTop: Math.round(dash.getBoundingClientRect().top),
          mainTop: Math.round(main.getBoundingClientRect().top),
          mainPadTop: ms.paddingTop,
          mainPad: ms.padding,
          mainDisplay: ms.display,
          mainJustify: ms.justifyContent,
          mainAlign: ms.alignItems,
          toolbarTop: Math.round(toolbar.getBoundingClientRect().top),
          toolbarH: Math.round(toolbar.getBoundingClientRect().height),
          toolbarDisplay: toolbarCs.display,
          toolbarPos: toolbarCs.position,
          toolbarMt: toolbarCs.marginTop,
          gapHeaderToToolbar: Math.round(
            toolbar.getBoundingClientRect().top - header.getBoundingClientRect().bottom
          ),
          gapDashToToolbar: Math.round(
            toolbar.getBoundingClientRect().top - dash.getBoundingClientRect().top
          ),
          gridRows: rows,
          bodyPadTop: getComputedStyle(document.body).paddingTop,
          headDisplay: head ? getComputedStyle(head).display : null,
          childCount: main.children.length,
          children,
          emailPageTop: (() => {
            const p = document.querySelector('.tma-dash__email-page');
            return p ? Math.round(p.getBoundingClientRect().top) : null;
          })(),
          emailTop: (() => {
            const p = document.querySelector('.tma-dash__email');
            return p ? Math.round(p.getBoundingClientRect().top) : null;
          })(),
          viewTop: Math.round(view.getBoundingClientRect().top),
          viewH: Math.round(view.getBoundingClientRect().height),
          viewDisplay: getComputedStyle(view).display,
          viewHidden: view.hidden,
          viewParentCls: view.parentElement && String(view.parentElement.className || '').slice(0, 80),
          viewIsMainChild: view.parentElement === main,
          toolbarParentChain: (function () {
            const chain = [];
            let el = toolbar;
            for (let i = 0; el && i < 8; i++) {
              chain.push({
                cls: String(el.className || '').slice(0, 80),
                view: el.getAttribute && el.getAttribute('data-view'),
                hidden: !!el.hidden,
                display: getComputedStyle(el).display,
                top: Math.round(el.getBoundingClientRect().top),
                h: Math.round(el.getBoundingClientRect().height),
                mt: getComputedStyle(el).marginTop,
                flex: getComputedStyle(el).flex,
              });
              el = el.parentElement;
            }
            return chain;
          })(),
          emailViews: Array.prototype.map.call(
            document.querySelectorAll('[data-view="email"]'),
            (el) => ({
              hidden: !!el.hidden,
              display: getComputedStyle(el).display,
              top: Math.round(el.getBoundingClientRect().top),
              h: Math.round(el.getBoundingClientRect().height),
              parent: el.parentElement && String(el.parentElement.className || '').slice(0, 40),
              sameAsView: el === view,
            }),
          ),
        });
      }));
    })
  `, true);

  console.log(JSON.stringify(result, null, 2));

  // Simulate the post-action failure mode: header briefly contributes a tall
  // auto row (old padding) while the blue bar stays fixed above it.
  const afterAction = await win.webContents.executeJavaScript(`
    new Promise((resolve) => {
      const dash = document.querySelector('.tma-dash');
      const header = document.querySelector('.tma-dash__header');
      // Force the pre-fix geometry the grid used to keep.
      header.style.height = '80px';
      header.style.minHeight = '80px';
      header.style.padding = '20px 28px';
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const toolbar = document.querySelector('.tma-dash__email-toolbar');
        resolve({
          gridRows: getComputedStyle(dash).gridTemplateRows,
          toolbarTop: Math.round(toolbar.getBoundingClientRect().top),
          headerBottom: Math.round(header.getBoundingClientRect().bottom),
          gap: Math.round(
            toolbar.getBoundingClientRect().top - document.querySelector('.tma-dash').getBoundingClientRect().top
          ),
          desktopBar: dash.classList.contains('tma-dash--desktop-bar'),
        });
      }));
    })
  `, true);
  console.log('after simulated header bulge', JSON.stringify(afterAction, null, 2));

  const rows = String(afterAction.gridRows || '');
  const ok = result.gapHeaderToToolbar <= 2
    && result.gapDashToToolbar <= 2
    && afterAction.gap <= 2
    && rows.startsWith('0px');
  console.log(ok ? '\nPASS — toolbar flush under bar' : '\nFAIL — empty band present');
  server.close();
  app.exit(ok ? 0 : 1);
});
