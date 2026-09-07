'use strict';

/*
 * Serves the portal's static assets from inside the app.
 *
 * A cold start used to fetch every stylesheet, script and icon over the
 * network — around 2,000 files — which is why the shell assembled itself on
 * screen instead of simply appearing. These ship in the package now and are
 * answered from disk.
 *
 * The safety condition is the whole design: a file is served from the bundle
 * *only* when its hash equals the one this deploy reports for that same path at
 * /desktop/assets. Assets a single deploy out of date would mean last week's
 * JavaScript running against this week's API — a failure far worse, and far
 * harder to diagnose, than a slow load. Anything that does not match, or any
 * doubt about what the portal is serving, falls back to the network, which is
 * precisely how the app behaved before any of this existed.
 *
 * `protocol.handle('https')` replaces the scheme handler for the session, so
 * every request in the app passes through here. Everything that is not a
 * bundled portal asset is handed straight back to the network, and
 * `bypassCustomProtocolHandlers` is what stops that from re-entering this
 * handler forever.
 */
const { protocol, net } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const shellCache = require('./shell-cache');
const fileCache = require('./file-cache');

const ROOT = path.join(__dirname, 'webassets');

// Only these trees are bundled; anything else is the network's business.
const SERVED = ['/css/', '/js/', '/audio/', '/images/', '/build/'];

const TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.bcmap': 'application/octet-stream',
  '.pfb': 'application/octet-stream',
  '.icc': 'application/vnd.iccprofile',
  '.wasm': 'application/wasm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
};

/* Electron's own answer, and never a reason to throw. Offline, holding a
   navigation for a check that cannot happen is pure delay. */
function online() {
  try {
    return net.isOnline();
  } catch {
    return true;
  }
}

function bundled() {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  } catch {
    return null;
  }
}

/**
 * WHATWG Headers values must be ByteStrings (code points ≤ 255). Electron's
 * net.fetch / undici throws an uncaught TypeError otherwise — which surfaces
 * as "A JavaScript error occurred in the main process" when a Cookie, Referer
 * or similar header carries a Unicode character (e.g. Turkish "ı").
 *
 * Re-encode offending values as UTF-8 bytes viewed as Latin-1 so undici
 * accepts them and the wire still carries the original UTF-8 octets.
 */
function headerValueToByteString(value) {
  if (typeof value !== 'string') return '';
  for (let i = 0; i < value.length; i++) {
    if (value.charCodeAt(i) > 255) {
      return Buffer.from(value, 'utf8').toString('latin1');
    }
  }
  return value;
}

function sanitizeRequestHeaders(headers) {
  const out = new Headers();
  const entries = headers && typeof headers.entries === 'function'
    ? headers.entries()
    : Object.entries(headers || {});
  for (const [key, value] of entries) {
    try {
      // Encode before set — Headers.set itself throws on code points > 255.
      out.set(key, headerValueToByteString(value));
    } catch (err) {
      console.warn('[asset-cache] dropped unsafe header', key, err && err.message);
    }
  }
  return out;
}

/**
 * Hand a request to the real network without re-entering this handler.
 *
 * THE CATCH IS THE POINT
 *
 * `protocol.handle` takes a promise, and a promise that *rejects* is a handler
 * that failed — Chromium has no idea what went wrong, so it reports the only
 * thing it can: ERR_UNEXPECTED. The try/catch around the call never helped,
 * because `net.fetch` does not throw, it rejects: every network failure in the
 * app — a dropped wifi, a DNS blip, a portal between deploys — arrived at the
 * window as ERR_UNEXPECTED instead of as itself.
 *
 * That is what the "Can't reach the portal / ERR_UNEXPECTED" screen was. Not a
 * mystery error: an ordinary failed request with its name taken off. Answering
 * 502 instead lets the app's own error page say something true.
 *
 * `redirect` is deliberately not forwarded. Chromium sets `follow` on
 * navigations here anyway, and the two other values both make `net.fetch`
 * throw rather than return — `manual` raises "Redirect was cancelled", which
 * would land right back in the rejection case above.
 *
 * A known limitation, and one this design cannot fix: because the redirect is
 * followed inside the handler, a navigation that redirects ends up showing the
 * final page at the *original* address — `/` displaying the sign-in page
 * rather than becoming `/auth/login`. `net.fetch` reports neither `redirected`
 * nor a final `url`, and `net.request`, which does expose the redirect, ignores
 * `bypassCustomProtocolHandlers` and re-enters this handler until the process
 * dies. There is no third option while the app navigates to a website at all —
 * which is one more argument for the app carrying its own shell.
 */
/*
 * The handler's own name for "there was no answer at all".
 *
 * It has to be distinguishable from a real 502 the portal itself returned:
 * one means the reader is on a train, the other means the firm's server is
 * unwell, and telling a reader on a train that the portal is broken is the
 * bug this header exists to prevent. main.js reads it to choose which screen
 * to show; file-cache reads the status to decide whether to serve its copy.
 */
const OFFLINE_HEADER = 'x-tma-offline';

function offlineResponse() {
  return new Response('', {
    status: 502,
    statusText: 'Bad Gateway',
    headers: { [OFFLINE_HEADER]: '1' },
  });
}

function networkFetch(request) {
  try {
    const headers = sanitizeRequestHeaders(request.headers);
    // Chromium's Request() constructor drops Range. pdf.js needs it; without
    // it the desktop app gets the PDF trailer, reports a page count, and
    // paints a white sheet.
    const range = request.headers.get('Range') || request.headers.get('range');
    if (range) headers.set('Range', range);

    const init = {
      method: request.method,
      headers: headers,
      bypassCustomProtocolHandlers: true,
    };
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      init.body = request.body;
      init.duplex = 'half';
    }

    return net.fetch(request.url, init).catch((err) => {
      console.error('[asset-cache] network fetch failed', request.url, err);

      return offlineResponse();
    });
  } catch (err) {
    console.error('[asset-cache] network fetch threw', err);

    return Promise.resolve(offlineResponse());
  }
}

/**
 * What this deploy says each of its assets hashes to.
 *
 * The two failure shapes are deliberately kept apart, because they mean
 * opposite things. `invalid` is the portal ANSWERING and making no sense — a
 * 500 mid-deploy, a body that is not the manifest — and the safe reading is
 * "trust nothing, use the network for everything". `unreachable` is no answer
 * at all: the machine is offline, and "use the network" is not advice, it is
 * the error screen. Offline, the bundle is all there is.
 */
async function serverManifest(origin) {
  let response;
  try {
    response = await net.fetch(new URL('/desktop/assets', origin).toString(), {
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache' },
      // Bounded: a flaky network that hangs would otherwise hold the asset
      // path hostage far longer than the offline case it resembles.
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    return 'unreachable';
  }

  try {
    if (!response.ok) return 'invalid';
    const body = await response.json();

    return body && body.files && typeof body.files === 'object' ? body : 'invalid';
  } catch {
    return 'invalid';
  }
}

/**
 * This deploy's identity, and nothing else.
 *
 * `/desktop/assets` is two thousand hashes; asking it every minute to learn a
 * single yes/no would be absurd, so the portal answers the yes/no separately.
 * An older portal that has never heard of the route says 404, which is not an
 * answer about the deploy at all — the caller falls back to the full manifest.
 */
async function remoteBuild(origin) {
  let response;
  try {
    response = await net.fetch(new URL('/desktop/build', origin).toString(), {
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache' },
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    return 'unreachable';
  }

  if (response.status === 404) return 'unsupported';

  try {
    if (!response.ok) return 'invalid';
    const body = await response.json();

    return body && typeof body.build === 'string' && body.build ? body.build : 'invalid';
  } catch {
    return 'invalid';
  }
}

/**
 * Resolves a portal URL to a bundled file, or null.
 *
 * The query string is dropped deliberately — the portal cache-busts with
 * `?v=12`, and the build hash already guarantees the bytes are the ones this
 * deploy would have sent, so the version tag carries no extra information here.
 */
function localFile(url, agreed) {
  if (!SERVED.some((prefix) => url.pathname.startsWith(prefix))) return null;

  // Only files this deploy agrees byte-for-byte with. Everything else — a file
  // the portal has changed since this build, one it no longer serves, one it
  // never had — goes to the network.
  if (agreed && !agreed.has(url.pathname)) return null;

  // Normalised before use: a path that climbs out of the bundle is not served.
  const rel = path.normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  const file = path.join(ROOT, rel);

  if (!file.startsWith(ROOT)) return null;
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return null;

  return file;
}

/*
 * The hashed CSS/JS the production shell actually requests.
 *
 * PortalShell rewrites the page to `build/app-<hash>.{css,js}` and deletes
 * last deploy's files. Those two URLs are what a cached shell asks for
 * offline — not the individual `/css/` and `/js/` files this package has
 * always carried. Serving the copy in the package, even when the hash in
 * the URL is one deploy old, is the difference between the portal and a
 * page of naked links.
 */
function packagedAppBundle(ext) {
  const dir = path.join(ROOT, 'build');
  try {
    if (!fs.existsSync(dir)) return null;
    const name = fs.readdirSync(dir).find((n) => (
      n.startsWith('app-') && n.endsWith(ext) && !n.endsWith('.map')
    ));
    if (!name) return null;
    const file = path.join(dir, name);
    if (!file.startsWith(dir) || !fs.statSync(file).isFile()) return null;

    return file;
  } catch {
    return null;
  }
}

function bundledAssetFor(url) {
  const exact = localFile(url, null);
  if (exact) return exact;
  if (!url.pathname.startsWith('/build/')) return null;
  const ext = path.extname(url.pathname).toLowerCase();
  if (ext !== '.css' && ext !== '.js') return null;

  return packagedAppBundle(ext);
}

/*
 * The handler's shared state. One handler serves the app's whole life —
 * `protocol.handle` cannot be stacked — so re-installing (tests do; a portal
 * URL override could) retargets this rather than registering again.
 *
 * `agreed` is three-valued and every value is load-bearing: `null` means
 * verification has not settled (assets wait for it), a Set means the deploy
 * answered (serve exactly the intersection), and `'unverified'` means the
 * portal is unreachable — serve the bundle as-is, because offline the choice
 * is not "fresh or stale", it is "the bundle or a blank window".
 */
const state = {
  origin: null,
  agreed: null,
  verify: null,
  installed: false,
  /* The build the last full verification ran against, and when we last asked
     whether it still is the one. `checking` holds an in-flight ask so a burst
     of navigations costs one request. */
  build: null,
  checkedAt: 0,
  checking: null,
  settled: null,
  /* Whether this portal can answer the cheap question at all. An older one
     cannot, and asking it per navigation would mean the full manifest per
     navigation — so on that portal the throttle holds even for a navigation. */
  cheap: true,
};

/*
 * How long a verdict about the deploy stands before the timer and the focus
 * handler bother asking again. Navigations do not use it — see below.
 */
const RECHECK_MS = 60_000;

/*
 * How long a navigation will wait for that answer.
 *
 * Nothing at a cold start: the window opens on the kept shell, which is the
 * entire point of keeping it. Afterwards a navigation is a reload or a deep
 * link, and both are worth a beat — the alternative is painting a page whose
 * stylesheet this deploy deleted an hour ago, which is what the reader was
 * reloading to escape. If the answer is slower than this the shell is served
 * anyway and the answer reloads the window when it lands, so a bad connection
 * costs the beat and nothing else.
 */
const NAV_HOLD_MS = 700;

function fileResponse(file) {
  return new Response(fs.createReadStream(file), {
    headers: {
      'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'content-length': String(fs.statSync(file).size),
      // Served from the package, so the renderer need not ask again.
      'cache-control': 'public, max-age=31536000, immutable',
    },
  });
}

async function handle(request) {
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return networkFetch(request);
  }

  if (url.origin !== state.origin) return networkFetch(request);

  /*
   * Every navigation is the moment to ask whether the portal is still the
   * deploy we verified against — unthrottled, because a reload is a
   * navigation and somebody reloading twice must not be answered from a
   * throttle. One request, one hash; the cost is the round trip, not the
   * two thousand hashes of the full manifest.
   *
   * A cold start does not wait for the answer (`checkedAt` is still zero) and
   * neither does an offline one. Everything else holds for it, briefly: this
   * is the request that decides whether the reader gets their portal or a
   * document naming files that no longer exist.
   */
  if (shellCache.isNavigation(request)) {
    revalidate({ force: true });

    if (state.checkedAt && state.settled && online()) {
      await Promise.race([state.settled, new Promise((r) => { setTimeout(r, NAV_HOLD_MS); })]);
    }
  }

  /*
   * A navigation is answered from the shell cache before anything else — and
   * before verification, which is the point: this is the response that has
   * the window painted while the network is still shaking hands.
   */
  const shell = await shellCache.maybeServe(url, request);
  if (shell) return shell;

  if (SERVED.some((prefix) => url.pathname.startsWith(prefix))) {
    /*
     * Assets hold for verification where a navigation does not. The shell has
     * already painted; a stylesheet arriving 300ms later costs nothing, and
     * serving it unverified against a moved deploy costs a broken page.
     */
    if (state.agreed === null && state.verify) await state.verify;

    const file = localFile(url, state.agreed instanceof Set ? state.agreed : null);
    if (file) return fileResponse(file);
  }

  /*
   * Document bytes: network first, kept on the way through, served back only
   * when the network could not answer at all. A real answer — a 404, a 403 —
   * always stands; the 502 below is only ever the handler's own name for a
   * dead connection. See file-cache.js for why this seam and no other.
   */
  let response;
  if (fileCache.cacheable(url, request.method)) {
    response = await networkFetch(request);

    if (response.ok) {
      /*
       * Only a whole file is worth keeping. The portal answers Range now — a
       * video seeking, or pdf.js pulling one page out of a 200-page scan — and
       * a 206 stored under the file's own path is a fragment masquerading as
       * the document: offline, the reader would open three pages of a contract
       * and have no way to tell.
       */
      const whole = response.status === 200 && !request.headers.get('range');

      if (whole) {
        try {
          const copy = response.clone();
          copy.arrayBuffer().then((buf) => {
            fileCache.store(url.pathname, Buffer.from(buf), copy.headers.get('content-type'));
          }).catch(() => { /* keeping a copy must never break the view */ });
        } catch { /* as above */ }
      }

      return response;
    }

    if (response.status === 502) {
      const kept = fileCache.serve(url.pathname);
      if (kept) return kept;
    } else {
      return response;
    }
  } else {
    response = await networkFetch(request);
  }

  /*
   * The network had nothing. If this was a navigation and we kept a shell,
   * paint it rather than handing Chromium a 502 that becomes an error page —
   * a reader who was signed in a minute ago should get their portal back,
   * with the data layer serving from its own cache behind it.
   *
   * Data fetches are the other half. Answering 502 here used to look like
   * the portal refusing: /me deleted the remembered identity, listings
   * skipped the replica, and queued writes looked delivered-then-rejected.
   * Page JS is written for a rejected fetch (the real "nothing answered"
   * case). Navigations still get the 502 — a rejected handler is
   * ERR_UNEXPECTED, which is the screen this header exists to replace.
   */
  if (response.headers.get(OFFLINE_HEADER)) {
    if (shellCache.isNavigation(request)) {
      const kept = await shellCache.maybeServe(url, request, { offline: true });
      if (kept) return kept;

      return response;
    }

    /*
     * The production shell asks for `build/app-<hash>.{css,js}`, not the
     * individual files. Online those come from the portal; offline the
     * package is all there is — including when the hash in the URL is one
     * deploy behind the copy we shipped. Without this the window is a
     * page of blue links on a blank field.
     */
    const asset = bundledAssetFor(url);
    if (asset) return fileResponse(asset);

    return Promise.reject(new Error('Failed to fetch'));
  }

  return shellCache.observe(url, request, response);
}

/**
 * Put the handler in place and start verifying.
 *
 * The handler is live before this function first awaits — a window created on
 * the next line is already served by it. What is awaited is the verification
 * against `/desktop/assets`, and the returned status describes its outcome;
 * callers who only need the handler need not wait at all.
 *
 * @param {string} origin The portal's origin.
 * @returns {Promise<{active: boolean, mode: string, reason: string, count?: number}>}
 */
function install(origin) {
  const local = bundled();
  if (!local) {
    return Promise.resolve({ active: false, mode: 'off', reason: 'no bundle in this build' });
  }

  state.origin = origin;
  state.agreed = null;
  state.build = null;
  state.checkedAt = 0;
  state.cheap = true;

  if (!state.installed) {
    state.installed = true;
    protocol.handle('https', (request) => {
      try {
        return handle(request);
      } catch (err) {
        console.error('[asset-cache] protocol handler failed', err);

        return new Response('', { status: 502, statusText: 'Bad Gateway' });
      }
    });
  }

  state.verify = verify(origin);

  return state.verify;
}

/**
 * Fetch the deploy's manifest and settle what may be served from the bundle.
 *
 * Runs at launch, and again whenever the cheap check says the portal has
 * moved. `state.agreed` is left null until it answers, which is what makes
 * asset requests hold rather than be served against a deploy we are no longer
 * sure of.
 */
function verify(origin) {
  const local = bundled();

  return serverManifest(origin).then((remote) => {
    state.checkedAt = Date.now();

    if (remote === 'unreachable') {
      /*
       * Offline. The bundle is served without a deploy to check against —
       * a deliberate loosening, and a bounded one: the moment a connection
       * exists, verification is what runs first, and the strict per-file
       * gate below is restored. The alternative was the app not opening.
       */
      state.agreed = 'unverified';

      return { active: true, mode: 'unverified', reason: 'portal unreachable — serving the bundle', count: local.count, total: local.count, stale: 0 };
    }

    if (remote === 'invalid') {
      // The portal answered and made no sense — a 500 mid-deploy, a body
      // that is not the manifest. It is THERE, so the network can be
      // trusted to serve assets; the bundle cannot be trusted to match.
      state.agreed = new Set();

      return { active: false, mode: 'network', reason: 'portal did not report its assets' };
    }

    /*
     * The intersection, not the whole set.
     *
     * Matching the two build hashes and refusing on any difference was the
     * first design, and it was too brittle to ever fire: a single file
     * drifting by a few bytes threw away all 2,156. Comparing per file keeps
     * exactly the same guarantee — a file is served only when its hash equals
     * what this deploy would have sent — while letting the rest come from
     * disk.
     */
    const agreed = new Set();
    for (const [url, hash] of Object.entries(local.files || {})) {
      if (remote.files[url] === hash) agreed.add(url);
    }
    state.agreed = agreed;
    state.build = remote.build || null;

    // The shell cache invalidates on this — a deploy means a shell captured
    // under the old one references bundles that may no longer exist.
    shellCache.noteBuild(remote.build);

    if (agreed.size === 0) {
      return { active: false, mode: 'network', reason: 'no bundled asset matches this deploy' };
    }

    return {
      active: true,
      mode: 'verified',
      reason: 'matched',
      count: agreed.size,
      total: local.count,
      stale: local.count - agreed.size,
    };
  });
}

/**
 * Ask again whether the portal is still the deploy we verified against.
 *
 * install() answered that once, at launch, and for the length of a launch it
 * was the whole story. It is not the whole story: the app stays open for days
 * and the portal deploys under it. The shell kept from this morning then names
 * bundles this afternoon's deploy has already deleted — `/build/app-<hash>.css`
 * is rebuilt under a new name every time and the old one is removed — and the
 * reader gets a page with no stylesheet and no script on it, which is what
 * being one deploy behind actually looks like. Nothing re-asked, so nothing
 * healed it short of quitting the app.
 *
 * Cheap on purpose, because it is asked on every navigation and on a timer:
 * `/desktop/build` is one hash. The full manifest is fetched only when that
 * hash has moved, which is the rare case by definition — and when it has,
 * `agreed` goes back to null first, so no asset is served from the old
 * intersection while the new one is on its way.
 *
 * Silence is not an answer. Unreachable and invalid both leave everything
 * exactly as it was: a reader on a train has not been handed a new deploy.
 *
 * @param {{force?: boolean}} [opts]
 * @returns {Promise<null|object>} the new verification, when one was needed.
 */
function revalidate(opts) {
  if (!state.installed || !state.origin) return Promise.resolve(null);
  if (state.checking) return state.checking;

  const force = !!(opts && opts.force) && state.cheap;

  if (!force && state.checkedAt && Date.now() - state.checkedAt < RECHECK_MS) {
    return Promise.resolve(null);
  }

  /*
   * Two promises, because they are worth waiting for by different amounts.
   *
   * `settled` is the cheap question — has the portal moved — and it is the one
   * a navigation holds for, because by the time it resolves the shell cache
   * has already been told and will refuse to hand back a copy that is one
   * deploy behind. The full manifest behind it takes as long as it takes, and
   * nothing waits on it but the assets, which hold on `agreed` being null.
   */
  state.settled = remoteBuild(state.origin).then((build) => {
    if (build === 'unreachable' || build === 'invalid') {
      // Ask again next time rather than settling into the throttle: nothing
      // was learned, so nothing should be assumed.
      return false;
    }

    state.checkedAt = Date.now();
    state.cheap = build !== 'unsupported';

    // A portal older than this route cannot answer cheaply; the full manifest
    // is the only way to ask it, and the throttle above is what keeps that rare.
    if (state.cheap && state.build && build === state.build) return false;

    /*
     * Told the moment we know, rather than when the manifest comes back a
     * second later. In that second the network may well serve the new shell —
     * a reload is the usual reason we are here — and a capture stamped with
     * the deploy we are in the middle of leaving would be dropped for nothing.
     */
    if (state.cheap) shellCache.noteBuild(build);

    state.agreed = null;
    state.verify = verify(state.origin);

    return true;
  }).catch(() => false);

  state.checking = state.settled
    .then((moved) => (moved ? state.verify : null))
    .finally(() => { state.checking = null; });

  return state.checking;
}

module.exports = {
  OFFLINE_HEADER,
  install,
  revalidate,
  // Test seam. The handler is the module — everything above is only reachable
  // through it, and a deploy landing mid-session is only testable through it.
  handle,
  bundled,
  localFile,
  bundledAssetFor,
  SERVED,
  ROOT,
  headerValueToByteString,
  sanitizeRequestHeaders,
};
