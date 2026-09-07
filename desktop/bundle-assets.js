'use strict';

/*
 * Copies the portal's static assets into the app, so a cold start does not
 * fetch a thousand icons over the network before it can draw.
 *
 * Run before packaging (npm run release does it). Produces:
 *
 *   webassets/<path>        the files themselves, mirroring the portal's URLs
 *   webassets/manifest.json { build, count, bytes }
 *
 * `build` is the whole point. It is a hash over every bundled file's path and
 * contents, and the portal computes the same value from its own copy at
 * /desktop/assets. The app serves locally only when the two match exactly —
 * because assets one deploy out of date are far worse than a slow load: last
 * week's JavaScript against this week's API fails in ways a spinner never does.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const OUT = path.join(__dirname, 'webassets');

/*
 * What the interface actually renders. Deliberately not all of public/:
 * images/design-system and images/components are ~15 MB of reference artwork
 * the app never puts on screen, and shipping them would be most of the weight
 * for none of the benefit. `build/` is the hashed CSS/JS the production
 * shell actually requests (PortalShell rewrites the tags); without it an
 * offline boot is a page of unstyled links.
 */
const INCLUDE = [
  'css',
  'js',
  'build',
  'audio',
  'images/icons',
  'images/brand',
  'images/illustrations',
  'images/avatars',
  'images/charts',
  'images/cursors',
  'images/emoji',
  'images/payment',
  'images/products',
  'images/settings',
];

// Editor leftovers and the corrupt backups that litter public/.
const SKIP = /(\.bak$|\.corrupt|\.orig$|\.DS_Store$|~$)/;

function walk(dir, onFile) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, onFile);
    else if (entry.isFile() && !SKIP.test(entry.name)) onFile(full);
  }
}

function build() {
  fs.rmSync(OUT, { recursive: true, force: true });

  const entries = [];
  const files = {};
  let bytes = 0;

  for (const rel of INCLUDE) {
    const from = path.join(PUBLIC, rel);
    if (!fs.existsSync(from)) continue;

    walk(from, (file) => {
      const url = '/' + path.relative(PUBLIC, file).split(path.sep).join('/');
      const body = fs.readFileSync(file);
      const target = path.join(OUT, url);

      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, body);

      const hash = crypto.createHash('sha256').update(body).digest('hex');
      entries.push(`${url}:${hash}`);
      files[url] = hash;
      bytes += body.length;
    });
  }

  // Sorted, so the hash depends on the content and not on the order the
  // filesystem happened to hand the files over.
  entries.sort();

  const manifest = {
    build: crypto.createHash('sha256').update(entries.join('\n')).digest('hex'),
    count: entries.length,
    bytes,
    // Per file, not just the whole set. The app matches each asset against the
    // portal's hash for that same path and serves only the ones that agree —
    // so a deploy that touches three files costs three network fetches rather
    // than falling back to all two thousand.
    files,
  };

  fs.writeFileSync(path.join(OUT, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(`  • bundled ${manifest.count} assets, ${(bytes / 1048576).toFixed(1)} MB`);
  console.log(`  • build ${manifest.build.slice(0, 16)}…`);

  return manifest;
}

if (require.main === module) build();

module.exports = { build, INCLUDE, SKIP, OUT };
