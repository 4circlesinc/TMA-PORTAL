/*
 * Drives a real update against the real artifacts in release/, over a local
 * feed — everything the shipped path does except the final swap, which is five
 * lines of bash that cannot run while this process holds the app open.
 *
 * Build something first (npm run dist), then: npm run test:update
 */
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { app } = require('electron');

const RELEASE_DIR = path.join(__dirname, 'release');

if (!fs.existsSync(path.join(RELEASE_DIR, 'latest-mac.yml'))) {
  console.error('No build to test. Run: npm run dist');
  process.exit(1);
}

/* A stand-in for portal.tmantoinelaw.com/desktop/. */
function serveRelease() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const name = decodeURIComponent(req.url.slice(1));
      const file = path.join(RELEASE_DIR, name);

      if (!fs.existsSync(file) || !file.startsWith(RELEASE_DIR)) {
        res.writeHead(404).end();
        return;
      }

      res.writeHead(200, { 'Content-Length': fs.statSync(file).size });
      fs.createReadStream(file).pipe(res);
    });

    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

let failures = 0;

function check(label, got, want) {
  const ok = got === want;
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
}

app.whenReady().then(async () => {
  const { server, port } = await serveRelease();

  // The feed URL is read at import, so point it at the local server first.
  process.env.TMA_UPDATE_URL = `http://127.0.0.1:${port}/`;
  const updater = require('./updater');

  const release = await updater.fetchManifest();
  console.log(`      feed offers ${release.version} (${release.file})`);

  check('manifest: names a zip', release.file.endsWith('.zip'), true);

  let progressed = false;
  const staged = await updater.stageRelease(release, (f) => { progressed = f > 0; });

  check('download: reported progress', progressed, true);
  check('staged: is an app bundle', staged.endsWith('.app'), true);
  check('staged: has a binary', fs.existsSync(path.join(staged, 'Contents', 'MacOS')), true);

  const version = execFileSync('/usr/libexec/PlistBuddy', [
    '-c', 'Print :CFBundleShortVersionString', path.join(staged, 'Contents', 'Info.plist'),
  ]).toString().trim();

  check('staged: is the version the feed advertised', version, release.version);

  // A substituted or corrupted archive must never reach the swap.
  let rejected = null;
  try {
    await updater.stageRelease({ ...release, sha512: 'AAAA' });
  } catch (error) {
    rejected = error.message;
  }
  check('tampered download is refused', rejected, 'The downloaded update did not match its checksum.');

  // Electron's asar integration makes fs treat app.asar as a directory, which
  // rmSync then cannot remove. rm has no such opinion.
  execFileSync('/bin/rm', ['-rf', path.dirname(path.dirname(staged))]);
  server.close();

  console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
  app.exit(failures ? 1 : 0);
});
