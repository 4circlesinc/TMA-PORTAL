/*
 * The shell cache: that it keeps the right document, serves it only when it
 * should, and — above all — that it lets go the moment it might be wrong.
 *
 * The refusals are the tests worth having, same as the asset cache. A shell
 * served to a signed-out visitor, under a moved deploy, or to a different
 * account than it was captured for is worse than a slow start: it is the
 * wrong capabilities pruning the wrong sidebar. So most of what follows sets
 * up a perfectly good cache and then proves one condition is enough to stop
 * it.
 *
 * Run with: npm run test:shell-cache
 */
const { app, session } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const shellCache = require('./shell-cache');

let failures = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
};

setTimeout(() => { console.log('\nFAILED — timed out'); app.exit(1); }, 30000).unref();

const ORIGIN = 'https://portal.test';

const SHELL = '<!DOCTYPE html><html><head><!-- tma-shell:test --></head><body>the shell</body></html>';

const nav = (u) => new Request(u, { headers: { accept: 'text/html,application/xhtml+xml' } });

const asset = (u) => new Request(u, { headers: { accept: 'text/css,*/*;q=0.1' } });


const htmlResponse = (body) => new Response(body, {
  status: 200,
  headers: { 'content-type': 'text/html; charset=utf-8' },
});

const settle = () => new Promise((r) => setTimeout(r, 100));

function scratch() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tma-shell-cache-'));
  shellCache._reset(dir);

  return dir;
}

app.whenReady().then(async () => {
  const url = (p) => new URL(p, ORIGIN);

  // Cookies persist in userData across test processes, and this test's own
  // last run left a session cookie behind — which turns "no cookie yet, no
  // shell" into a check that only passes on a fresh machine.
  await session.defaultSession.clearStorageData({ origin: ORIGIN, storages: ['cookies'] });

  /* ── the small parts ────────────────────────────────────────────── */

  check('a navigation is recognised by its Accept',
    shellCache.isNavigation(nav(`${ORIGIN}/clients`)), true);
  check('a stylesheet request is not one',
    shellCache.isNavigation(asset(`${ORIGIN}/css/tokens.css`)), false);
  check('the first segment of a deep link', shellCache.firstSegment('/clients/nadia/edit'), 'clients');
  check('and of the root', shellCache.firstSegment('/'), '');

  /* ── capture ───────────────────────────────────────────────────── */

  scratch();

  // Before the deploy is known, nothing is kept — a capture with no build
  // stamp could never be invalidated by the one mismatch that breaks pages.
  shellCache.observe(url('/clients'), nav(`${ORIGIN}/clients`), htmlResponse(SHELL));
  await settle();
  check('nothing is captured before the deploy is known', shellCache.readMeta(), null);

  shellCache.noteBuild('build-1');
  shellCache.observe(url('/clients'), nav(`${ORIGIN}/clients`), htmlResponse(SHELL));
  await settle();
  let meta = shellCache.readMeta();
  check('a shell navigation is captured', !!meta, true);
  check('stamped with the deploy', meta.build, 'build-1');
  check('and remembers where the shell lives', meta.segments, ['clients']);

  // A page without the marker is somebody's document, not the shell.
  shellCache.observe(url('/privacy-policy'), nav(`${ORIGIN}/privacy-policy`), htmlResponse('<html><body>legal</body></html>'));
  await settle();
  check('a page without the marker is not captured',
    shellCache.readMeta().segments, ['clients']);

  const observed = shellCache.observe(url('/clients'), nav(`${ORIGIN}/clients`), htmlResponse(SHELL));
  check('the response flows through to the renderer', await observed.text(), SHELL);

  /* ── serving, and every reason not to ──────────────────────────── */

  // No session cookie yet: a stranger gets the network and its sign-in bounce.
  check('no session cookie, no shell',
    await shellCache.maybeServe(url('/clients'), nav(`${ORIGIN}/clients`)), null);

  await session.defaultSession.cookies.set({
    url: ORIGIN, name: 'tma_portal_session', value: 'x', expirationDate: Date.now() / 1000 + 3600,
  });

  const served = await shellCache.maybeServe(url('/clients'), nav(`${ORIGIN}/clients`));
  check('with a session, the shell is served from disk', await served.text(), SHELL);
  check('the root is always the shell\'s page',
    !!(await shellCache.maybeServe(url('/'), nav(`${ORIGIN}/`))), true);
  check('a deep link under a known segment is served',
    !!(await shellCache.maybeServe(url('/clients/nadia/edit'), nav(`${ORIGIN}/clients/nadia/edit`))), true);
  check('a segment that never served the shell is not',
    await shellCache.maybeServe(url('/auth/login'), nav(`${ORIGIN}/auth/login`)), null);
  check('a subresource is never answered with a page',
    await shellCache.maybeServe(url('/clients'), asset(`${ORIGIN}/clients`)), null);

  /* ── the deploy moves ──────────────────────────────────────────── */

  let staleReason = null;
  shellCache.on({ stale: (reason) => { staleReason = reason; } });

  shellCache.noteBuild('build-2');
  check('a moved deploy drops the copy', shellCache.readMeta(), null);
  check('and asks for a reload, because the wrong shell is on screen',
    staleReason, 'deploy-changed');
  check('nothing is served after', await shellCache.maybeServe(url('/clients'), nav(`${ORIGIN}/clients`)), null);

  // Recapture under the new deploy heals it without anyone doing anything.
  shellCache.observe(url('/clients'), nav(`${ORIGIN}/clients`), htmlResponse(SHELL));
  await settle();
  check('a fresh capture under the new deploy heals the cache',
    !!(await shellCache.maybeServe(url('/clients'), nav(`${ORIGIN}/clients`))), true);

  /* ── the session dies behind the cookie ────────────────────────── */

  staleReason = null;
  shellCache.observe(url('/me'), nav(`${ORIGIN}/me`), new Response('', { status: 401 }));
  await settle();
  check('a dead session reloads the served shell away', staleReason, 'signed-out');
  check('and the copy is gone', shellCache.readMeta(), null);

  /* ── a shell the network served is not ours to reload away ─────── */

  scratch();
  await session.defaultSession.cookies.set({
    url: ORIGIN, name: 'tma_portal_session', value: 'x', expirationDate: Date.now() / 1000 + 3600,
  });
  shellCache.noteBuild('build-3');
  shellCache.observe(url('/clients'), nav(`${ORIGIN}/clients`), htmlResponse(SHELL));
  await settle();
  check('a copy is kept under this deploy',
    !!(await shellCache.maybeServe(url('/clients'), nav(`${ORIGIN}/clients`))), true);

  // …and then the network serves one itself — a reload, a deep link. That is
  // the document on screen now, whatever happens to the copy on disk.
  shellCache.observe(url('/clients'), nav(`${ORIGIN}/clients`), htmlResponse(SHELL));
  await settle();

  staleReason = null;
  shellCache.on({ stale: (reason) => { staleReason = reason; } });
  shellCache.noteBuild('build-4');
  check('a deploy still drops the copy', shellCache.readMeta(), null);
  check('but reloads nothing — the network served what is on screen', staleReason, null);

  /* ── somebody else signs in ────────────────────────────────────── */

  const me = (id) => new Response(JSON.stringify({ id }), {
    status: 200, headers: { 'content-type': 'application/json' },
  });

  scratch();
  await session.defaultSession.cookies.set({
    url: ORIGIN, name: 'tma_portal_session', value: 'x', expirationDate: Date.now() / 1000 + 3600,
  });
  shellCache.noteBuild('build-2');
  shellCache.observe(url('/me'), nav(`${ORIGIN}/me`), me(7));
  await settle();
  shellCache.observe(url('/clients'), nav(`${ORIGIN}/clients`), htmlResponse(SHELL));
  await settle();
  check('a capture is stamped with its account', shellCache.readMeta().account, '7');

  staleReason = null;
  shellCache.on({ stale: (reason) => { staleReason = reason; } });
  check('the same account is served',
    !!(await shellCache.maybeServe(url('/clients'), nav(`${ORIGIN}/clients`))), true);

  shellCache.observe(url('/me'), nav(`${ORIGIN}/me`), me(7));
  await settle();
  check('the same account changes nothing', staleReason, null);

  shellCache.observe(url('/me'), nav(`${ORIGIN}/me`), me(9));
  await settle();
  check('a different account drops the shell it was shown', staleReason, 'account-changed');
  check('and the copy with it', shellCache.readMeta(), null);

  console.log(failures ? `\nFAILED (${failures})` : '\nPASSED');
  app.exit(failures ? 1 : 0);
}).catch((err) => {
  console.error(err);
  app.exit(2);
});
