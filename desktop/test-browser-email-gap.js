/*
 * Browser (no desktop-bar) gap between header and email toolbar.
 * Run: env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron test-browser-email-gap.js
 */
const { app, BrowserWindow } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');

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
<link rel="stylesheet" href="/css/theme.css">
<link rel="stylesheet" href="/css/components.css">
<link rel="stylesheet" href="/css/dashboard.css">
<link rel="stylesheet" href="/css/dashboard-tma-overrides.css">
</head>
<body>
<div class="tma-dash tma-dash--email">
  <aside class="tma-dash__sidebar"></aside>
  <header class="tma-dash__header">
    <div class="tma-dash__header-left"><nav class="tma-dash__breadcrumb"><span class="tma-dash__crumb--current">email</span></nav></div>
    <div class="tma-dash__header-center"><div class="tma-dash__email-search">Search in mail</div></div>
    <div class="tma-dash__header-right"></div>
  </header>
  <main class="tma-dash__main">
    <div class="tma-dash__main-head" hidden style="display:none!important">
      <div class="tma-dash__main-head-left"><h1 class="tma-dash__page-title">Email</h1></div>
    </div>
    <div class="tma-dash__view" data-view="email">
      <div class="tma-dash__email"><div class="tma-dash__email-page">
        <div class="tma-dash__email-fit">
          <div class="tma-dash__toolbar tma-dash__email-toolbar">TOOLBAR</div>
          <div class="tma-dash__email-layout">panes</div>
        </div>
      </div></div>
    </div>
  </main>
  <aside class="tma-dash__rightbar"></aside>
</div>
</body></html>`;

setTimeout(() => {
  console.log('TIMEOUT');
  app.exit(1);
}, 12000).unref();

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

  const win = new BrowserWindow({ width: 1400, height: 900, show: false });
  await win.loadURL(`http://127.0.0.1:${server.address().port}/`);
  const result = await win.webContents.executeJavaScript(`(() => {
    const dash = document.querySelector('.tma-dash');
    const main = document.querySelector('.tma-dash__main');
    const head = document.querySelector('.tma-dash__main-head');
    const header = document.querySelector('.tma-dash__header');
    const toolbar = document.querySelector('.tma-dash__email-toolbar');
    const measure = () => ({
      gap: Math.round(toolbar.getBoundingClientRect().top - header.getBoundingClientRect().bottom),
      headerH: Math.round(header.getBoundingClientRect().height),
      mainPadTop: getComputedStyle(main).paddingTop,
      headDisplay: getComputedStyle(head).display,
      headH: Math.round(head.getBoundingClientRect().height),
      toolbarMt: getComputedStyle(toolbar).marginTop,
      fitPt: getComputedStyle(document.querySelector('.tma-dash__email-fit')).paddingTop,
      mainTop: Math.round(main.getBoundingClientRect().top),
      toolbarTop: Math.round(toolbar.getBoundingClientRect().top),
    });
    const before = measure();

    const toast = document.createElement('div');
    toast.className = 'tma-dash__email-toast tma-dash__email-toast--visible';
    toast.innerHTML = '<span>Message pinned</span>';
    toast.hidden = false;
    dash.appendChild(toast);
    const withToast = Object.assign(measure(), {
      toastPos: getComputedStyle(toast).position,
      toastDisplay: getComputedStyle(toast).display,
      toastTop: Math.round(toast.getBoundingClientRect().top),
      toastH: Math.round(toast.getBoundingClientRect().height),
      gridRows: getComputedStyle(dash).gridTemplateRows,
    });

    head.hidden = false;
    head.removeAttribute('hidden');
    head.style.cssText = 'display:flex';
    const withHead = measure();

    // Simulate the pin failure mode: shell loses .tma-dash--email and
    // main-head tries to come back. View-keyed CSS must still hold the gap.
    main.style.padding = '';
    dash.classList.remove('tma-dash--email');
    head.hidden = false;
    head.removeAttribute('hidden');
    head.style.cssText = 'display:flex';
    const leaked = measure();

    dash.classList.add('tma-dash--email');
    head.hidden = true;
    head.setAttribute('hidden', '');
    head.style.display = 'none';
    main.style.setProperty('padding-top', '0', 'important');
    const restored = measure();

    return { before, withToast, withHead, leaked, restored };
  })()`);

  console.log(JSON.stringify(result, null, 2));
  const bad = result.withToast.gap > 16
    || result.withHead.gap > 16
    || result.before.gap > 16
    || result.leaked.gap > 16;
  console.log(bad ? 'FAIL — gap present in browser shell' : 'PASS — browser gap within card inset');
  server.close();
  app.exit(bad ? 1 : 0);
});
