/*
 * The last gate before a build can ship: every local require() in the
 * packaged asar must resolve INSIDE the archive.
 *
 * The build's `files` list is a hand-kept whitelist, and 0.8.24 shipped
 * without signin-handoff.js — main.js threw MODULE_NOT_FOUND at launch,
 * the uncaught-exception guard kept the process alive, and the app "ran"
 * windowless forever. Nothing in `npm test` could catch it, because the
 * tests run from this directory where every file exists; only the archive
 * knows what actually shipped. The release scripts chain this after
 * electron-builder, so that mistake fails the build instead of the fleet.
 */
const fs = require('node:fs');
const asar = require('@electron/asar');

const archives = [
  'release/mac-arm64/TM ANTOINE Portal.app/Contents/Resources/app.asar',
  'release/win-unpacked/resources/app.asar',
].filter((p) => fs.existsSync(p));

if (!archives.length) {
  console.error('verify-asar: no app.asar found under release/ — build first');
  process.exit(1);
}

let failed = false;

for (const archive of archives) {
  const listing = new Set(
    asar.listPackage(archive, {}).map((p) => p.replace(/\\/g, '/').replace(/^\//, ''))
  );

  for (const file of listing) {
    // Top-level app modules only: webassets are page assets, not requires.
    if (!file.endsWith('.js') || file.includes('/')) continue;
    const source = asar.extractFile(archive, file).toString('utf8');
    for (const match of source.matchAll(/require\('\.\/([a-z0-9-]+)'\)/g)) {
      const dep = `${match[1]}.js`;
      if (!listing.has(dep)) {
        console.error(`verify-asar: ${file} requires ./${match[1]} but ${dep} is NOT packaged (${archive})`);
        failed = true;
      }
    }

    /*
     * Art the code reaches for by name, too.
     *
     * The same whitelist governs `assets/`, and a missing picture fails more
     * quietly than a missing module: no exception, no log, just a window with
     * a hole in it or a stock Electron icon where the firm's mark should be.
     * The tray icon, the dock icon and the About panel are all reached this
     * way, and every one of them is invisible in a test run from a directory
     * where the file exists.
     */
    for (const match of source.matchAll(/'assets',\s*'([^']+)'/g)) {
      const asset = `assets/${match[1]}`;
      if (!listing.has(asset)) {
        console.error(`verify-asar: ${file} loads ${asset} but it is NOT packaged (${archive})`);
        failed = true;
      }
    }
  }

  if (!failed) console.log(`verify-asar: ${archive} — every require resolves`);
}

process.exit(failed ? 1 : 0);
