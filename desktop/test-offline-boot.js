/*
 * Booting with no network.
 *
 * The question this answers is the one a reader actually asks: I was signed in,
 * I quit, my train went into a tunnel, I opened the app again — do I get my
 * portal, or do I get a URL and an error?
 *
 * It drives the real seam. asset-cache's handler is what every navigation goes
 * through, and shell-cache.maybeServe is its first move; `net.fetch` is stubbed
 * to fail the way a dead network fails, so nothing here depends on there being
 * a portal to talk to.
 *
 * Run with: npm run test:offline-boot
 */
const { app, session, net } = require('electron');
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
const SHELL = '<!DOCTYPE html><html><head><!-- tma-shell:test --></head><body>the portal</body></html>';
const nav = (u) => new Request(u, { headers: { accept: 'text/html,application/xhtml+xml' } });
const settle = () => new Promise((r) => setTimeout(r, 120));

app.whenReady().then(async () => {
  const url = (p) => new URL(p, ORIGIN);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tma-offline-boot-'));
  shellCache._reset(dir);

  await session.defaultSession.clearStorageData({ origin: ORIGIN, storages: ['cookies'] });
  await session.defaultSession.cookies.set({
    url: ORIGIN, name: 'tm-antoine-advisory-session', value: 'x', httpOnly: true,
  });

  /* ── online: the portal answers, and the shell is kept ───────────── */
  shellCache.noteBuild('build-1');
  shellCache.observe(url('/'), nav(`${ORIGIN}/`), new Response(SHELL, {
    status: 200, headers: { 'content-type': 'text/html; charset=utf-8' },
  }));
  await settle();

  check('a shell was captured while online', !!shellCache.readMeta(), true);

  /* ── the network dies ────────────────────────────────────────────── */
  const realFetch = net.fetch;
  net.fetch = () => Promise.reject(new Error('net::ERR_INTERNET_DISCONNECTED'));

  try {
    const served = await shellCache.maybeServe(url('/'), nav(`${ORIGIN}/`));
    check('offline, the cached shell is served', !!served, true);
    if (served) {
      const body = await served.text();
      check('and it is the portal, not an error page', body.includes('the portal'), true);
    }

    // The deep link a reader actually quit on. Online this is refused — the
    // network is right there to answer properly. Offline it is exactly what
    // the kept shell is for: the SPA router takes the path from here.
    const deepOnline = await shellCache.maybeServe(url('/clients'), nav(`${ORIGIN}/clients`));
    check('an uncaptured segment is still refused while online', deepOnline, null);

    const deepOffline = await shellCache.maybeServe(
      url('/clients'), nav(`${ORIGIN}/clients`), { offline: true },
    );
    check('…but offline the kept shell answers it', !!deepOffline, true);

    // The prefixes that are not the SPA stay refused even with no network:
    // portal chrome around a sign-in page would be worse than the notice.
    for (const p of ['/auth/login', '/r/token123', '/design/db']) {
      const refused = await shellCache.maybeServe(url(p), nav(`${ORIGIN}${p}`), { offline: true });
      check(`offline, ${p} is still not the shell`, refused, null);
    }

    /* ── the case that produces the URL error screen ─────────────────
     * A machine with nothing kept — first run, or a cleared cache — has
     * nothing to paint. What matters is that the app SAYS "offline"
     * rather than showing a URL and a network error code.
     */
    shellCache._reset(fs.mkdtempSync(path.join(os.tmpdir(), 'tma-offline-empty-')));
    const nothing = await shellCache.maybeServe(url('/'), nav(`${ORIGIN}/`));
    check('with an empty cache there is nothing to serve', nothing, null);
  } finally {
    net.fetch = realFetch;
  }

  console.log(failures ? `\nFAILED (${failures})` : '\nAll offline-boot checks passed');
  app.exit(failures ? 1 : 0);
});
