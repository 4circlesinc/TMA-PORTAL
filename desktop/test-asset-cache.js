/*
 * The bundled-asset cache: that it serves from disk when the build matches,
 * and — far more importantly — that it refuses to when it does not.
 *
 * The refusal is the assertion worth having. Serving assets one deploy out of
 * date means last week's JavaScript against this week's API, which fails in
 * ways no spinner ever would, so every path that is not an exact match must
 * end up on the network.
 *
 * Run with: npm run test:asset-cache
 */
const { app, net } = require('electron');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const assetCache = require('./asset-cache');

let failures = 0;
const check = (label, got, want) => {
  const ok = got === want;
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
};

setTimeout(() => { console.log('\nFAILED — timed out'); app.exit(1); }, 45000).unref();

app.whenReady().then(async () => {
  const local = assetCache.bundled();
  check('the build ships a bundle', !!local && typeof local.build === 'string', true);
  check('and it is not empty', local.count > 500, true);

  /* ── the guard ─────────────────────────────────────────────────── */

  let reported = null;
  const server = http.createServer((req, res) => {
    if (req.url === '/desktop/assets') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(reported === null ? {} : reported));
      return;
    }
    res.writeHead(404).end();
  });

  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;

  // A portal whose every asset differs. Nothing may be served from the bundle.
  reported = { build: 'x', files: Object.fromEntries(
    Object.keys(local.files).map((u) => [u, 'a-completely-different-hash'])) };
  let result = await assetCache.install(origin);
  check('a wholly different deploy does not activate', result.active, false);
  check('and says why', result.reason, 'no bundled asset matches this deploy');

  // A portal that answers with nothing useful.
  reported = null;
  result = await assetCache.install(origin);
  check('no build reported does not activate', result.active, false);

  // A portal that is not there at all.
  server.close();
  result = await assetCache.install(origin);
  check('an unreachable portal does not activate', result.active, false);

  /* ── path safety ───────────────────────────────────────────────── */

  const url = (u) => new URL(u, 'https://example.test');
  check('serves a bundled stylesheet', !!assetCache.localFile(url('/css/tokens.css')), true);
  check('ignores the cache-busting query', !!assetCache.localFile(url('/js/notify-store.js?v=12')), true);
  check('leaves unbundled paths alone', assetCache.localFile(url('/me')), null);
  check('leaves an unknown asset alone', assetCache.localFile(url('/css/does-not-exist.css')), null);

  // The per-file gate: a file the deploy no longer agrees with is not served
  // even though it is sitting right there in the bundle.
  const only = new Set(['/css/tokens.css']);
  check('serves a file the deploy agrees with', !!assetCache.localFile(url('/css/tokens.css'), only), true);
  check('refuses one it does not', assetCache.localFile(url('/js/notify-store.js'), only), null);
  // A path climbing out of the bundle must not resolve to something on disk.
  check('refuses to climb out of the bundle',
    assetCache.localFile(url('/css/../../../../etc/passwd')), null);

  /* ── the happy path, end to end ────────────────────────────────── */

  const matching = http.createServer((req, res) => {
    if (req.url === '/desktop/assets') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ build: local.build, files: local.files }));
      return;
    }
    res.writeHead(500).end();
  });
  await new Promise((r) => matching.listen(0, '127.0.0.1', r));
  const good = `http://127.0.0.1:${matching.address().port}`;

  result = await assetCache.install(good);
  check('a matching deploy activates', result.active, true);
  check('and serves every bundled file', result.count, local.count);
  check('with none left stale', result.stale, 0);

  // And the file it would serve is byte-identical to the portal's own copy.
  const served = assetCache.localFile(url('/css/tokens.css'));
  const origin_file = path.resolve(__dirname, '..', 'public', 'css', 'tokens.css');
  check('the served bytes are the portal\'s own',
    fs.readFileSync(served).equals(fs.readFileSync(origin_file)), true);

  matching.close();
  console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
  app.exit(failures ? 1 : 0);
});
