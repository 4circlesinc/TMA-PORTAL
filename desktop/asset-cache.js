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
const SERVED = ['/css/', '/js/', '/audio/', '/images/'];

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
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
};

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
function networkFetch(request) {
  try {
    const init = {
      method: request.method,
      headers: sanitizeRequestHeaders(request.headers),
    };
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      init.body = request.body;
      init.duplex = 'half';
    }

    return net.fetch(new Request(request.url, init), {
      bypassCustomProtocolHandlers: true,
    }).catch((err) => {
      console.error('[asset-cache] network fetch failed', request.url, err);

      return new Response('', { status: 502, statusText: 'Bad Gateway' });
    });
  } catch (err) {
    console.error('[asset-cache] network fetch threw', err);

    return Promise.resolve(new Response('', { status: 502, statusText: 'Bad Gateway' }));
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
};

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
  if (fileCache.cacheable(url, request.method)) {
    const response = await networkFetch(request);

    if (response.ok) {
      try {
        const copy = response.clone();
        copy.arrayBuffer().then((buf) => {
          fileCache.store(url.pathname, Buffer.from(buf), copy.headers.get('content-type'));
        }).catch(() => { /* keeping a copy must never break the view */ });
      } catch { /* as above */ }

      return response;
    }

    if (response.status === 502) {
      const kept = fileCache.serve(url.pathname);
      if (kept) return kept;
    }

    return response;
  }

  return shellCache.observe(url, request, await networkFetch(request));
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

  state.verify = serverManifest(origin).then((remote) => {
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

  return state.verify;
}

module.exports = {
  install,
  bundled,
  localFile,
  SERVED,
  ROOT,
  headerValueToByteString,
  sanitizeRequestHeaders,
};
