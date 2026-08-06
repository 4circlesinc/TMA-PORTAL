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

/** What this deploy says each of its assets hashes to. Null on any doubt. */
async function serverManifest(origin) {
  try {
    const response = await net.fetch(new URL('/desktop/assets', origin).toString(), {
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache' },
    });

    if (!response.ok) return null;
    const body = await response.json();
    return body && body.files && typeof body.files === 'object' ? body : null;
  } catch {
    // Offline, or the portal is between deploys. Either way: use the network,
    // which will fail in its own visible way rather than serving stale files.
    return null;
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

/**
 * @param {string} origin The portal's origin.
 * @returns {Promise<{active: boolean, reason: string, count?: number}>}
 */
async function install(origin) {
  const local = bundled();
  if (!local) return { active: false, reason: 'no bundle in this build' };

  const remote = await serverManifest(origin);
  if (!remote) return { active: false, reason: 'portal did not report its assets' };

  /*
   * The intersection, not the whole set.
   *
   * Matching the two build hashes and refusing on any difference was the first
   * design, and it was too brittle to ever fire: a single file drifting by a
   * few bytes — a deploy slightly ahead of the build, a rebuilt stylesheet —
   * threw away all 2,156. Comparing per file keeps exactly the same guarantee,
   * because a file is served only when its hash equals what this deploy would
   * have sent, while letting the rest still come from disk.
   */
  const agreed = new Set();
  for (const [url, hash] of Object.entries(local.files || {})) {
    if (remote.files[url] === hash) agreed.add(url);
  }

  if (agreed.size === 0) {
    return { active: false, reason: 'no bundled asset matches this deploy' };
  }

  protocol.handle('https', (request) => {
    let url;
    try {
      url = new URL(request.url);
    } catch {
      return net.fetch(request, { bypassCustomProtocolHandlers: true });
    }

    const file = url.origin === origin ? localFile(url, agreed) : null;
    if (!file) return net.fetch(request, { bypassCustomProtocolHandlers: true });

    return new Response(fs.createReadStream(file), {
      headers: {
        'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'content-length': String(fs.statSync(file).size),
        // Served from the package, so the renderer need not ask again.
        'cache-control': 'public, max-age=31536000, immutable',
      },
    });
  });

  return {
    active: true,
    reason: 'matched',
    count: agreed.size,
    total: local.count,
    stale: local.count - agreed.size,
  };
}

module.exports = { install, bundled, localFile, SERVED, ROOT };
