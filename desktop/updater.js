/*
 * Updates.
 *
 * Not electron-updater: that hands the install to Squirrel, which refuses to
 * replace a bundle whose code signature it cannot verify, so on an unsigned
 * build it downloads a new version and then fails at the last step. This does
 * the swap itself — download the zip, check it against the hash in the
 * manifest, put the new bundle where the old one was, relaunch. Works signed
 * or unsigned, and keeps working if a certificate arrives later.
 *
 * The feed is the same latest-mac.yml electron-builder already generates, so
 * `npm run dist` + `php artisan desktop:publish` is unchanged.
 */
const { app, dialog, shell, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn, execFile } = require('node:child_process');
const { pipeline } = require('node:stream/promises');
const { Readable } = require('node:stream');

const FEED_URL = process.env.TMA_UPDATE_URL || 'https://portal.tmantoinelaw.com/desktop/';

const CHECK_INTERVAL = 3600000; // hourly, so a deploy lands the same day

/* ------------------------------------------------------------------- manifest */

/**
 * electron-builder's latest-mac.yml, reduced to what an install needs. A real
 * YAML parser would be a dependency for four scalars off a file we generate
 * ourselves.
 */
function parseManifest(text) {
  const scalar = (key) => {
    // Top-level keys only: the `files:` list repeats url/sha512 nested under
    // "  - ", and taking those would pick the dmg as often as the zip.
    const match = text.match(new RegExp(`^${key}:[ \\t]*(.+?)[ \\t]*$`, 'm'));
    return match ? match[1].replace(/^['"]|['"]$/g, '') : null;
  };

  const version = scalar('version');
  const file = scalar('path');
  const sha512 = scalar('sha512');

  if (!version || !file || !sha512) return null;

  return { version, file, sha512 };
}

/** Numeric semver compare; returns > 0 when `a` is newer than `b`. */
function compareVersions(a, b) {
  const parts = (v) => String(v).split('.').map((n) => Number.parseInt(n, 10) || 0);
  const [x, y] = [parts(a), parts(b)];

  for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
    const diff = (x[i] || 0) - (y[i] || 0);
    if (diff) return diff;
  }

  return 0;
}

async function fetchManifest() {
  const response = await fetch(new URL('latest-mac.yml', FEED_URL), {
    cache: 'no-store',
    headers: { 'Cache-Control': 'no-cache' },
  });

  if (!response.ok) throw new Error(`Update feed returned ${response.status}`);

  return parseManifest(await response.text());
}

/* ------------------------------------------------------------------- download */

async function download(fileName, onProgress) {
  const response = await fetch(new URL(encodeURIComponent(fileName), FEED_URL));

  if (!response.ok || !response.body) throw new Error(`Download failed (${response.status})`);

  const total = Number(response.headers.get('content-length')) || 0;
  const target = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tma-update-')), fileName);

  const hash = crypto.createHash('sha512');
  let seen = 0;

  const source = Readable.fromWeb(response.body);
  source.on('data', (chunk) => {
    hash.update(chunk);
    seen += chunk.length;
    if (total) onProgress(seen / total);
  });

  await pipeline(source, fs.createWriteStream(target));

  return { target, digest: hash.digest('base64') };
}

/* ---------------------------------------------------------------------- install */

/** /Applications/TM ANTOINE Portal.app, derived from …/Contents/MacOS/binary. */
function bundlePath() {
  return path.resolve(app.getPath('exe'), '..', '..', '..');
}

function canReplaceBundle() {
  try {
    fs.accessSync(path.dirname(bundlePath()), fs.constants.W_OK);
    fs.accessSync(bundlePath(), fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

const unzip = (archive, into) => new Promise((resolve, reject) => {
  // ditto, not unzip: it is what preserves bundle symlinks and metadata.
  execFile('/usr/bin/ditto', ['-xk', archive, into], (error) => (error ? reject(error) : resolve()));
});

/**
 * Downloads a release and unpacks it, leaving a ready bundle in a temp dir.
 * Everything that can go wrong quietly — a truncated download, a corrupted or
 * substituted archive, a zip that is not an app — fails here, before anything
 * on disk is touched.
 */
async function stageRelease(release, onProgress = () => {}) {
  const { target, digest } = await download(release.file, onProgress);

  if (digest !== release.sha512) {
    throw new Error('The downloaded update did not match its checksum.');
  }

  const extracted = path.join(path.dirname(target), 'unpacked');
  await unzip(target, extracted);

  const bundle = fs.readdirSync(extracted).find((entry) => entry.endsWith('.app'));
  if (!bundle) throw new Error('That update did not contain an app.');

  return path.join(extracted, bundle);
}

/**
 * Swaps the bundle and relaunches. The app cannot delete itself while running,
 * so this hands the job to a detached script that waits for us to exit first.
 */
function replaceAndRestart(newBundle) {
  const target = bundlePath();
  const script = path.join(os.tmpdir(), `tma-update-${process.pid}.sh`);

  fs.writeFileSync(script, `#!/bin/bash
while kill -0 ${process.pid} 2>/dev/null; do sleep 0.2; done
rm -rf ${JSON.stringify(target)}
/usr/bin/ditto ${JSON.stringify(newBundle)} ${JSON.stringify(target)}
/usr/bin/open ${JSON.stringify(target)}
rm -f ${JSON.stringify(script)}
`, { mode: 0o755 });

  spawn('/bin/bash', [script], { detached: true, stdio: 'ignore' }).unref();

  app.quit();
}

/* ------------------------------------------------------------------------ flow */

let checking = false;
let declined = null; // version the user said "Later" to, so we ask once

function progressBar(fraction) {
  const win = BrowserWindow.getAllWindows()[0];
  if (win && !win.isDestroyed()) win.setProgressBar(fraction);
}

async function runUpdate(release, parentWindow) {
  const { response } = await dialog.showMessageBox(parentWindow, {
    type: 'info',
    buttons: ['Later', 'Update Now'],
    defaultId: 1,
    cancelId: 0,
    message: `Version ${release.version} is available`,
    detail: "The app will download it, restart, and pick up where you left off.",
  });

  if (response !== 1) {
    declined = release.version;
    return;
  }

  // An unwritable bundle means it was installed by the .pkg as root. Hand the
  // installer back to the OS rather than asking for a password we should not
  // be collecting.
  if (!canReplaceBundle()) {
    await shell.openExternal(new URL(encodeURIComponent(release.file.replace(/-mac\.zip$/, '.pkg')), FEED_URL).toString());
    return;
  }

  try {
    progressBar(0);
    const bundle = await stageRelease(release, progressBar);
    progressBar(-1);

    replaceAndRestart(bundle);
  } catch (error) {
    progressBar(-1);
    dialog.showMessageBox(parentWindow, {
      type: 'error',
      message: "That update couldn't be installed",
      detail: `${error.message}\n\nYou can keep using this version — we'll try again later.`,
    });
  }
}

/**
 * @param {object} options
 * @param {boolean} options.silent  true for background checks: say nothing
 *                                  when already current, and honour "Later".
 */
async function checkForUpdates({ silent = true } = {}) {
  if (checking || !app.isPackaged) return null;
  checking = true;

  const parentWindow = BrowserWindow.getAllWindows()[0] || null;

  try {
    const release = await fetchManifest();

    if (!release || compareVersions(release.version, app.getVersion()) <= 0) {
      if (!silent) {
        dialog.showMessageBox(parentWindow, {
          type: 'info',
          message: "You're up to date",
          detail: `Version ${app.getVersion()}.`,
        });
      }
      return null;
    }

    if (silent && declined === release.version) return null;

    await runUpdate(release, parentWindow);
    return release;
  } catch (error) {
    if (!silent) {
      dialog.showMessageBox(parentWindow, {
        type: 'error',
        message: "Couldn't check for updates",
        detail: error.message,
      });
    }
    return null;
  } finally {
    checking = false;
  }
}

function start() {
  if (!app.isPackaged) return;

  setTimeout(() => checkForUpdates(), 10000);
  setInterval(() => checkForUpdates(), CHECK_INTERVAL);
}

module.exports = {
  start, checkForUpdates, fetchManifest, stageRelease, parseManifest, compareVersions, FEED_URL,
};
