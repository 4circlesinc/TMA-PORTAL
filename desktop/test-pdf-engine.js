/*
 * pdf.js against the engine the app actually ships.
 *
 * Browsers update themselves; Electron does not. pdf.js is written for this
 * quarter's Chromium, so every upgrade of either can leave a built-in missing
 * in the app that no browser will ever miss — and the viewers treat a page
 * paint as best-effort, so the failure is a white page with the right page
 * count, not an error. toHex() was the first (no PDF opened at all);
 * Map.prototype.getOrInsertComputed was the second (every page white for a
 * week). public/js/vendor/pdf-compat.mjs fills the gaps it knows about; this
 * is the test that finds the next one.
 *
 * It serves public/js/vendor from the repo, prints a few PDFs with Chromium
 * itself (Latin, serif, CJK — embedded TrueType, CID-keyed, and the standard
 * font substitution path), then renders page one of each exactly the way
 * portal-lightbox.js does and checks that ink actually landed on the canvas.
 * No desktop layer is involved: the question here is the JS engine.
 *
 * Run with: npm run test:pdf-engine
 */
const { app, BrowserWindow } = require('electron');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PUBLIC = path.join(__dirname, '..', 'public');
const VENDOR = path.join(PUBLIC, 'js', 'vendor');

let failures = 0;
const check = (label, got, want) => {
  const ok = got === want;
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
};

setTimeout(() => { console.log('\nFAILED — timed out'); app.exit(1); }, 90000).unref();

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.mjs': 'text/javascript',
  '.pdf': 'application/pdf',
  '.wasm': 'application/wasm',
  '.bcmap': 'application/octet-stream',
  '.pfb': 'application/octet-stream',
  '.ttf': 'font/ttf',
  '.icc': 'application/vnd.iccprofile',
};

/* The loader/worker query strings the portal's callers use — see
 * tests/Feature/PdfViewerCompatTest.php, which pins them. */
const LOADER = '/js/vendor/pdf-loader.mjs?v=5';
const WORKER = '/js/vendor/pdf-worker.mjs?v=2';

const PAGE = `<!doctype html><meta charset="utf-8"><canvas id="c"></canvas>
<script type="module">
  const errors = [];
  addEventListener('error', (e) => errors.push('error: ' + e.message));
  addEventListener('unhandledrejection', (e) => errors.push('rejection: ' + (e.reason && e.reason.message || e.reason)));
  const warn = console.warn;
  console.warn = (...a) => { errors.push('warn: ' + a.map(String).join(' ')); warn(...a); };

  const name = new URLSearchParams(location.search).get('pdf');
  try {
    const lib = await import(${JSON.stringify(LOADER)});
    lib.GlobalWorkerOptions.workerSrc = new URL(${JSON.stringify(WORKER)}, location.href).href;

    // portal-lightbox.js wholeFilePdf + mountPdfInto, step for step.
    const res = await fetch('/pdf/' + name, { credentials: 'same-origin', headers: { Accept: 'application/pdf' } });
    const buf = await res.arrayBuffer();
    const doc = await lib.getDocument({
      data: new Uint8Array(buf), disableRange: true, disableStream: true, useWorkerFetch: false, isEvalSupported: false,
    }).promise;
    const page = await doc.getPage(1);
    const unscaled = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: 820 / unscaled.width });
    const canvas = document.getElementById('c');
    canvas.style.colorScheme = 'light';
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);

    let renderError = null;
    try {
      await page.render({ canvas, viewport, background: '#ffffff' }).promise;
    } catch (e) {
      renderError = String(e && e.message || e);
    }

    const d = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let ink = 0, white = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] < 128 && d[i + 1] < 128 && d[i + 2] < 128) ink++;
      else if (d[i] > 250 && d[i + 1] > 250 && d[i + 2] > 250) white++;
    }
    window.__result = { numPages: doc.numPages, ink, white, total: d.length / 4, renderError, errors };
  } catch (e) {
    window.__result = { failed: String(e && e.message || e), errors };
  }
</script>`;

const DOCS = {
  'latin.pdf': '<p style="font-family:Arial,Helvetica,sans-serif;font-size:28px">Hello from the TMA portal 0123456789</p>'
    + '<p style="font-family:Georgia,serif;font-size:20px">A second paragraph, in a serif face, to embed two fonts.</p>',
  'cjk.pdf': '<p style="font-size:28px">医疗证明 Medical Certificate 北京市 2026</p><p style="font-size:20px">患者姓名：张三</p>',
};

function serve(pdfs) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/test.html') {
        res.writeHead(200, { 'Content-Type': TYPES['.html'] });
        res.end(PAGE);
        return;
      }
      if (url.pathname.startsWith('/pdf/')) {
        const buf = pdfs[url.pathname.slice(5)];
        if (!buf) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, { 'Content-Type': TYPES['.pdf'] });
        res.end(buf);
        return;
      }
      if (url.pathname.startsWith('/js/vendor/')) {
        const file = path.join(VENDOR, url.pathname.slice('/js/vendor/'.length));
        if (file.startsWith(VENDOR) && fs.existsSync(file) && fs.statSync(file).isFile()) {
          res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
          fs.createReadStream(file).pipe(res);
          return;
        }
      }
      res.writeHead(404);
      res.end();
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1000, height: 1400 });

  const pdfs = {};
  for (const [name, html] of Object.entries(DOCS)) {
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<!doctype html><meta charset="utf-8"><body>' + html));
    pdfs[name] = await win.webContents.printToPDF({ pageSize: 'A4' });
  }

  const server = await serve(pdfs);
  const origin = `http://127.0.0.1:${server.address().port}`;

  for (const name of Object.keys(pdfs)) {
    await win.loadURL(`${origin}/test.html?pdf=${name}`);
    let r = null;
    for (let i = 0; i < 200 && !r; i++) {
      r = await win.webContents.executeJavaScript('window.__result || null');
      if (!r) await new Promise((res) => setTimeout(res, 100));
    }
    if (!r) { check(`${name}: rendered within the timeout`, false, true); continue; }

    check(`${name}: the document opened`, r.failed || null, null);
    check(`${name}: page count`, r.numPages, 1);
    check(`${name}: page.render() resolved`, r.renderError, null);
    // Printed text on A4 at 820px wide: a few thousand dark pixels at least,
    // and a mostly white sheet — a transparent or black canvas fails both.
    check(`${name}: ink on the page`, r.ink > 2000, true);
    check(`${name}: on a white sheet`, r.white > r.total * 0.8, true);
    check(`${name}: no warnings or errors`, r.errors.length, 0);
    if (r.errors.length) console.log('      ' + r.errors.slice(0, 5).join('\n      '));
  }

  server.close();
  console.log(failures ? `\nFAILED — ${failures} check(s)` : '\nOK');
  app.exit(failures ? 1 : 0);
}).catch((err) => {
  console.log('FAILED —', err && err.stack || err);
  app.exit(1);
});
