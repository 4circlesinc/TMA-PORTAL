'use strict';

/*
 * Serves the portal's static assets from inside the app.
 *
 * A cold start used to fetch every stylesheet, script and icon over the
 * network — around 2,000 files — which is why the shell assembled itself on
 * screen instead of simply appearing. These ship in the package now and are
 * answered from disk.
 *
 * The safety condition is the whole design: the bundled copy is used *only*
 * when its build hash equals the one this deploy reports at /desktop/assets.
 * Assets a single deploy out of date would mean last week's JavaScript running
 * against this week's API — a failure far worse, and far harder to diagnose,
 * than a slow load. Anything short of an exact match falls back to the network,
 * which is precisely how the app behaved before any of this existed.
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

/** What this deploy says its assets hash to. Null on any doubt. */
async function serverBuild(origin) {
  try {
    const response = await net.fetch(new URL('/desktop/assets', origin).toString(), {
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache' },
    });

    if (!response.ok) return null;
    const body = await response.json();
    return typeof body.build === 'string' ? body.build : null;
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
function localFile(url) {
  if (!SERVED.some((prefix) => url.pathname.startsWith(prefix))) return null;

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

  const remote = await serverBuild(origin);
  if (!remote) return { active: false, reason: 'portal did not report an asset build' };

  if (remote !== local.build) {
    return { active: false, reason: 'bundle is out of date with the portal' };
  }

  protocol.handle('https', (request) => {
    let url;
    try {
      url = new URL(request.url);
    } catch {
      return net.fetch(request, { bypassCustomProtocolHandlers: true });
    }

    const file = url.origin === origin ? localFile(url) : null;
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

  return { active: true, reason: 'matched', count: local.count };
}

module.exports = { install, bundled, localFile, SERVED, ROOT };
