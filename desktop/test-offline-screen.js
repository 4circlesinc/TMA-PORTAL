/*
 * The offline screen, rendered.
 *
 * Not a unit test of a string: it loads the real page main.js builds, in a real
 * BrowserWindow, and captures it — because the thing being checked is that a
 * reader sees a plain sentence instead of a URL and a net::ERR code.
 */
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const OUT = process.argv[2] || '/tmp/offline-screen.png';
const PORTAL_URL = 'http://localhost:8001';

const page = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8')
  .match(/function showOffline\(win\) \{\s*const page = `([\s\S]*?)`;/)[1]
  .replace(/\$\{PORTAL_URL\}/g, PORTAL_URL);

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 900, height: 620, show: false });
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(page)}`);
  await new Promise((r) => setTimeout(r, 700));

  const text = await win.webContents.executeJavaScript('document.body.innerText');
  const checks = [
    ['says it plainly',            /you'?re offline/i.test(text)],
    ['no URL on screen',           !/https?:\/\//i.test(text)],
    ['no net::ERR code',           !/net::|ERR_/i.test(text)],
    ['no scary error wording',     !/can'?t reach|failed|error/i.test(text)],
    ['reassures about queued work', /saved|sent/i.test(text)],
  ];
  let bad = 0;
  for (const [label, ok] of checks) { if (!ok) bad += 1; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); }
  console.log('\n--- what the reader sees ---\n' + text.trim() + '\n---');

  fs.writeFileSync(OUT, (await win.webContents.capturePage()).toPNG());
  console.log('shot:', OUT);
  app.exit(bad ? 1 : 0);
});
