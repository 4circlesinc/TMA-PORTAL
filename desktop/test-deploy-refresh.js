/*
 * The portal deploys while the app is open.
 *
 * This is the failure it exists for, and it is worth stating plainly because
 * the symptom looks like nothing else: the reader gets the portal with no
 * stylesheet and no script on it — bare links down the left, icons at their
 * natural size — and reloading does not help.
 *
 * The cause was that verification ran once, at launch. Every build writes
 * `build/app-<hash>.css` and deletes the one before it, so the shell kept from
 * this morning names two files this afternoon's deploy no longer has. The
 * shell cache went on serving that shell because the only deploy it had ever
 * heard of was the one from launch, which still matched. Nothing re-asked, so
 * nothing healed; quitting the app was the fix.
 *
 * So: a navigation asks again, holds briefly for the answer, and a portal that
 * has moved is served from the network instead. Driven through handle(),
 * because the seam between the two caches is where the bug lived.
 *
 * Run with: npm run test:deploy-refresh
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

/* The shell as the portal serves it: the marker capture keys on, and the one
   bundle name that a deploy invalidates. */
const shellFor = (build) => '<!DOCTYPE html><html><head><!-- tma-shell:test -->'
  + `<link rel="stylesheet" href="build/app-${build}.css"></head><body>portal</body></html>`;

const nav = (u) => new Request(u, { headers: { accept: 'text/html,application/xhtml+xml' } });

const settle = () => new Promise((r) => setTimeout(r, 150));

app.whenReady().then(async () => {
  let build = 'deploy-1';
  let served = 0;

  const portal = http.createServer((req, res) => {
    const [route] = req.url.split('?');

    if (route === '/desktop/build') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ build }));

      return;
    }

    if (route === '/desktop/assets') {
      // No file agrees, which is beside the point here: what is under test is
      // the deploy's identity, not which assets the bundle may serve.
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ build, files: {} }));

      return;
    }

    if (route === '/dashboard') {
      served += 1;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(shellFor(build));

      return;
    }

    res.writeHead(404).end();
  });

  await new Promise((r) => portal.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${portal.address().port}`;

  shellCache._reset(fs.mkdtempSync(path.join(os.tmpdir(), 'tma-deploy-refresh-')));

  let staleReason = null;
  shellCache.on({ stale: (reason) => { staleReason = reason; } });

  await session.defaultSession.cookies.set({
    url: origin, name: 'tma_portal_session', value: 'x', expirationDate: Date.now() / 1000 + 3600,
  });

  await assetCache.install(origin);

  /* ── the app opens, and keeps what it was sent ─────────────────── */

  let body = await (await assetCache.handle(nav(`${origin}/dashboard`))).text();
  check('the first navigation comes from the portal', body, shellFor('deploy-1'));
  await settle();

  body = await (await assetCache.handle(nav(`${origin}/dashboard`))).text();
  check('the next one is answered from the kept copy', body, shellFor('deploy-1'));
  check('and cost the portal nothing', served, 1);

  /* ── the portal deploys under it ───────────────────────────────── */

  build = 'deploy-2';

  body = await (await assetCache.handle(nav(`${origin}/dashboard`))).text();
  check('a navigation after a deploy is served the new shell', body, shellFor('deploy-2'));
  check('which means it went to the portal for it', served, 2);
  check('and the window on the old one is told to reload', staleReason, 'deploy-changed');
  await settle();

  /* ── and settles onto the new deploy ───────────────────────────── */

  staleReason = null;
  body = await (await assetCache.handle(nav(`${origin}/dashboard`))).text();
  check('the new shell is kept in its turn', body, shellFor('deploy-2'));
  check('served from disk again', served, 2);
  check('with nothing left to reload away', staleReason, null);

  portal.close();
  console.log(failures ? `\nFAILED (${failures})` : '\nPASSED');
  app.exit(failures ? 1 : 0);
}).catch((err) => {
  console.error(err);
  app.exit(2);
});
