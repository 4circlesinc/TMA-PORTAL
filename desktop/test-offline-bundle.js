/*
 * Opening offline runs the portal code the kept shell was served with.
 *
 * The shell cache keeps one deploy's document, and that document asks for
 * the same deploy's `/build/app-<hash>.{css,js}`. Offline, those used to be
 * answered with the copy shipped inside the installed app, whatever deploy
 * the release was built from. On a Windows machine still on September's
 * release that was September's portal code, offline queue included, painted
 * into November's page, every time the app opened with no connection.
 *
 * So the network's own copy is kept as it passes, and offline it comes
 * first. Driven through handle(), against a real local server that is then
 * switched off, so nothing here assumes how a dead network fails.
 *
 * Run with: npm run test:offline-bundle
 */
const { app, session } = require('electron');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const assetCache = require('./asset-cache');
const shellCache = require('./shell-cache');

let failures = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
};

setTimeout(() => { console.log('\nFAILED — timed out'); app.exit(1); }, 45000).unref();

const TODAY = 'abc123def456';
const TODAY_JS = 'window.__portal = "today";';
const TODAY_CSS = 'body { color: today; }';
const shell = '<!DOCTYPE html><html><head><!-- tma-shell:test -->'
  + `<link rel="stylesheet" href="build/app-${TODAY}.css"></head>`
  + `<body>portal<script src="build/app-${TODAY}.js"></script></body></html>`;

const nav = (u) => new Request(u, { headers: { accept: 'text/html,application/xhtml+xml' } });
const asset = (u) => new Request(u, { headers: { accept: '*/*' } });
const settle = () => new Promise((r) => setTimeout(r, 200));

app.whenReady().then(async () => {
  const portal = http.createServer((req, res) => {
    const [route] = req.url.split('?');
    const send = (type, body) => { res.writeHead(200, { 'Content-Type': type }); res.end(body); };

    if (route === '/desktop/build') return send('application/json', JSON.stringify({ build: 'deploy-today' }));
    if (route === '/desktop/assets') return send('application/json', JSON.stringify({ build: 'deploy-today', files: {} }));
    if (route === '/dashboard') return send('text/html; charset=utf-8', shell);
    if (route === `/build/app-${TODAY}.js`) return send('text/javascript', TODAY_JS);
    if (route === `/build/app-${TODAY}.css`) return send('text/css', TODAY_CSS);

    res.writeHead(404).end();
  });

  await new Promise((r) => portal.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${portal.address().port}`;

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tma-offline-bundle-'));
  shellCache._reset(dir);
  await session.defaultSession.cookies.set({
    url: origin, name: 'tma_portal_session', value: 'x', expirationDate: Date.now() / 1000 + 3600,
  });
  await assetCache.install(origin);

  /* ── online: the page and the bundles it names come from the portal ── */
  await (await assetCache.handle(nav(`${origin}/dashboard`))).text();
  const js = await (await assetCache.handle(asset(`${origin}/build/app-${TODAY}.js?v=1`))).text();
  const css = await (await assetCache.handle(asset(`${origin}/build/app-${TODAY}.css`))).text();
  check('online, the script comes from the portal', js, TODAY_JS);
  check('online, the stylesheet comes from the portal', css, TODAY_CSS);
  await settle();

  check('the script it was served is kept on this machine', !!shellCache.keptBundle(`/build/app-${TODAY}.js`), true);
  check('and the stylesheet', !!shellCache.keptBundle(`/build/app-${TODAY}.css`), true);
  check('nothing else is taken for a bundle', shellCache.keptBundle('/js/portal-queue.js'), null);

  /* ── the network goes ───────────────────────────────────────────── */
  await new Promise((r) => portal.close(r));
  portal.closeAllConnections && portal.closeAllConnections();

  const offJs = await assetCache.handle(asset(`${origin}/build/app-${TODAY}.js`));
  check('offline, the script is answered', offJs.status, 200);
  check('offline, it is the code the page was served with, not the package\'s', await offJs.text(), TODAY_JS);
  const offCss = await assetCache.handle(asset(`${origin}/build/app-${TODAY}.css`));
  check('offline, the stylesheet is today\'s too', await offCss.text(), TODAY_CSS);

  // A bundle nobody kept (a cache cleared, a first run offline) still falls
  // back to the package rather than leaving the page without a script.
  const packaged = assetCache.bundledAssetFor(new URL(`${origin}/build/app-0000000000ff.js`));
  if (packaged) {
    const fallback = await assetCache.handle(asset(`${origin}/build/app-0000000000ff.js`));
    check('a bundle never kept falls back to the package', await fallback.text(), fs.readFileSync(packaged, 'utf8'));
  } else {
    console.log('SKIP  no packaged bundle in webassets/build to fall back to');
  }

  /* ── kept, but not for ever ─────────────────────────────────────── */
  const keep = (hash, n) => shellCache.observe(
    new URL(`${origin}/build/app-${hash}.js`),
    asset(`${origin}/build/app-${hash}.js`),
    new Response(`/* ${n} */`, { status: 200, headers: { 'content-type': 'text/javascript' } }),
  );
  for (let i = 1; i <= 5; i += 1) {
    keep(`00000000000${i}`, i);
    // Distinct times, so "newest" means something.
    await new Promise((r) => setTimeout(r, 30));
  }
  await settle();
  const left = fs.readdirSync(path.join(dir, 'build')).filter((n) => n.endsWith('.js')).sort();
  check('only the newest three scripts are kept', left, ['app-000000000003.js', 'app-000000000004.js', 'app-000000000005.js']);
  check('no half-written file is left behind', fs.readdirSync(path.join(dir, 'build')).filter((n) => n.endsWith('.part')), []);

  // A fragment is not the file.
  shellCache.observe(
    new URL(`${origin}/build/app-0000000000aa.js`),
    new Request(`${origin}/build/app-0000000000aa.js`, { headers: { range: 'bytes=0-9' } }),
    new Response('partial', { status: 200, headers: { 'content-type': 'text/javascript' } }),
  );
  await settle();
  check('a ranged answer is never kept as the bundle', shellCache.keptBundle('/build/app-0000000000aa.js'), null);

  console.log(failures ? `\nFAILED (${failures})` : '\nAll offline-bundle checks passed');
  app.exit(failures ? 1 : 0);
}).catch((err) => {
  console.error(err);
  app.exit(2);
});
