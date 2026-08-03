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
 * The feed is the same latest-mac.yml / latest.yml electron-builder already
 * generates, so `npm run dist` + `php artisan desktop:publish` is unchanged.
 *
 * Windows takes the shorter road: NSIS installers already know how to replace
 * a running install, so there the download is an .exe that gets verified and
 * run, rather than a bundle swapped by hand.
 */
const { app, dialog, shell, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn, execFile } = require('node:child_process');
const { pipeline } = require('node:stream/promises');
const { Readable, Transform } = require('node:stream');

const updateWindow = require('./update-window');
const updateAvailable = require('./update-available');

const { version: APP_VERSION } = require('./package.json');

const FEED_URL = process.env.TMA_UPDATE_URL || 'https://portal.tmantoinelaw.com/desktop/';

const CHECK_INTERVAL = 3600000; // hourly, so a deploy lands the same day

const IS_MAC = process.platform === 'darwin';

// electron-builder names the Windows manifest latest.yml and the macOS one
// latest-mac.yml; both sit in the same bucket, so one feed serves both.
const MANIFEST = IS_MAC ? 'latest-mac.yml' : 'latest.yml';

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

  return { version, file, sha512, notes: releaseNotes(text) };
}

/**
 * The "What's new" bullets, from the releaseNotes electron-builder copies out
 * of release-notes.md at build time.
 *
 * YAML gives it to us one of two ways depending on the content, and both turn
 * up in practice, so both are read:
 *
 *   releaseNotes: |-        a block scalar, the lines indented beneath it
 *     - one
 *     - two
 *
 *   releaseNotes: "- one\n- two"    a quoted scalar with escaped newlines
 *
 * Missing notes are not an error — an older release has none, and the window
 * simply hides its disclosure.
 */
function releaseNotes(text) {
  const block = text.match(/^releaseNotes:[ \t]*[|>]-?[ \t]*\n((?:[ \t]+.*\n?)*)/m);

  const raw = block
    ? block[1].replace(/^[ \t]+/gm, '')
    : (text.match(/^releaseNotes:[ \t]*(.+)$/m) || [])[1];

  if (!raw) return [];

  return String(raw)
    .replace(/^['"]|['"]$/g, '')
    // A quoted scalar carries its newlines escaped.
    .replace(/\\n/g, '\n')
    .split('\n')
    // Markdown bullets, so strip the marker the file was written with.
    .map((line) => line.trim().replace(/^[-*•]\s*/, '').trim())
    .filter(Boolean);
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
  const response = await fetch(new URL(MANIFEST, FEED_URL), {
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

  let seen = 0;

  /*
   * Progress only. Counting inside the pipeline rather than from a separate
   * `source.on('data')` listener, because that listener is a second, competing
   * reader of the same chunk buffers.
   */
  const meter = new Transform({
    transform(chunk, _encoding, done) {
      seen += chunk.length;
      if (total) onProgress(seen / total);
      done(null, chunk);
    },
  });

  try {
    await pipeline(Readable.fromWeb(response.body), meter, fs.createWriteStream(target));
  } catch (error) {
    // A connection dropped part-way ("terminated") still leaves whatever
    // arrived on disk. Retrying starts a fresh directory, so without this the
    // partial file is stranded — one abandoned attempt was found holding 38 MB,
    // and an older one 323 MB.
    discard(target);
    throw error;
  }

  return { target, digest: await digestOf(target) };
}

/**
 * The SHA-512 of the file as it actually sits on disk.
 *
 * This used to be accumulated from the download stream, which certified bytes
 * that had passed through memory rather than bytes that landed. Those are not
 * the same thing: hashing from an `on('data')` listener reads each chunk the
 * moment it arrives, while the write of that same chunk completes later, and a
 * buffer reused in between leaves the file holding something the hash never
 * saw. It fails silently and looks impossible — the checksum passes and then
 * the archive will not open.
 *
 * Seen in the wild on 0.8.6→0.8.7: two attempts, both exactly the right length,
 * both diverging from the real artifact at a chunk boundary — 557056 in one,
 * 1458176 in the other — and differing from each other. Verified downloads,
 * corrupt files, "Couldn't read pkzip signature".
 *
 * The file is what ditto opens and what replaces the app, so the file is what
 * has to be verified. One extra read of a 90 MB file is nothing against
 * installing an archive nobody checked.
 */
function digestOf(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha512');
    fs.createReadStream(file)
      .on('error', reject)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('base64')));
  });
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
 *
 * On Windows there is nothing to unpack: the artifact is the NSIS installer,
 * so a verified download is already the finished article.
 */
async function stageRelease(release, onProgress = () => {}, onPhase = () => {}) {
  let lastError = null;

  /*
   * Retried, because the failures worth surviving here are transient: a
   * connection dropped part-way ("terminated"), or a file that arrives whole
   * and wrong. Both are cured by asking again, and neither is the user's
   * problem to solve — before this, one bad download meant an error dialog and
   * a manual reinstall for something that would have worked on a second try.
   */
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    try {
      onPhase('downloading');
      return await stageOnce(release, onProgress, onPhase);
    } catch (error) {
      lastError = error;
      if (attempt < ATTEMPTS) await wait(attempt * 2000);
    }
  }

  throw lastError;
}

/** How many times the whole download is worth repeating before giving up. */
const ATTEMPTS = 3;

const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/** One go: download, verify, unpack. Cleans up after itself when it fails. */
async function stageOnce(release, onProgress, onPhase) {
  const { target, digest } = await download(release.file, onProgress);

  if (digest !== release.sha512) {
    // 90 MB per attempt, and these were piling up in /var/folders unnoticed.
    discard(target);
    throw new Error('The downloaded update did not match its checksum.');
  }

  // Past this point nothing reports a fraction — unzipping a 90 MB bundle and
  // swapping it takes real time with no way to measure it, so the screen is
  // told to stop pretending it knows how far along it is.
  onPhase('installing');

  if (!IS_MAC) return target;

  const extracted = path.join(path.dirname(target), 'unpacked');

  try {
    await unzip(target, extracted);

    const bundle = fs.readdirSync(extracted).find((entry) => entry.endsWith('.app'));
    if (!bundle) throw new Error('That update did not contain an app.');

    return path.join(extracted, bundle);
  } catch (error) {
    discard(target);
    throw error;
  }
}

/**
 * Throws away a failed attempt's temp directory.
 *
 * Each one holds a 90 MB archive plus whatever was unpacked before it failed,
 * and nothing else ever removes them — a handful of failed updates had left
 * most of a gigabyte sitting in /var/folders.
 */
function discard(target) {
  try {
    fs.rmSync(path.dirname(target), { recursive: true, force: true });
  } catch {
    // Temp is the OS's to reclaim; a failure to tidy is not worth surfacing.
  }
}

/**
 * Hands the installer the job of replacing us.
 *
 * NSIS already knows how to shut down a running instance, swap the files and
 * start the new one, which is the whole reason Windows does not need the
 * hand-rolled swap below. `/S` keeps it silent so the update feels like the
 * macOS one; `--force-run` is what electron-builder's installer reads to
 * relaunch afterwards.
 */
function runInstaller(installer) {
  spawn(installer, ['/S', '--force-run'], { detached: true, stdio: 'ignore' }).unref();
  app.quit();
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
let onStateChange = () => {};

/** A version the user deferred, so the menu can offer it again by name. */
const deferredUpdate = () => declined;

function defer(version) {
  declined = version;
  onStateChange();
}

function progressBar(fraction) {
  const win = BrowserWindow.getAllWindows()[0];
  if (win && !win.isDestroyed()) win.setProgressBar(fraction);
}

async function runUpdate(release, parentWindow) {
  /*
   * Was dialog.showMessageBox. A native message box cannot carry a disclosure,
   * so the only thing it could say about an update was its version number —
   * people were asked to accept a change they had no way to read.
   */
  const choice = await updateAvailable.show({
    version: release.version,
    notes: release.notes || [],
  });

  if (choice !== 'update') {
    defer(release.version);
    return;
  }

  // An unwritable bundle means it was installed by the .pkg as root. Hand the
  // installer back to the OS rather than asking for a password we should not
  // be collecting.
  if (IS_MAC && !canReplaceBundle()) {
    await shell.openExternal(new URL(encodeURIComponent(release.file.replace(/-mac\.zip$/, '.pkg')), FEED_URL).toString());
    return;
  }

  try {
    // Downloading 90 MB used to happen with nothing on screen but the dock
    // progress bar, and then the app vanished and came back — which on a slow
    // connection is a long silence followed by what looks like a crash.
    updateWindow.show(release.version);
    progressBar(0);

    const staged = await stageRelease(
      release,
      (fraction) => { progressBar(fraction); updateWindow.setProgress(fraction); },
      (phase) => updateWindow.setPhase(phase),
    );

    progressBar(-1);
    updateWindow.setPhase('restarting');

    if (IS_MAC) replaceAndRestart(staged);
    else runInstaller(staged);
  } catch (error) {
    progressBar(-1);
    // The screen says the app is restarting; it is not, so take it away before
    // the error appears behind it.
    updateWindow.close();
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

    if (!release || compareVersions(release.version, APP_VERSION) <= 0) {
      if (!silent) {
        dialog.showMessageBox(parentWindow, {
          type: 'info',
          message: "You're up to date",
          detail: `Version ${APP_VERSION}.`,
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
  start,
  checkForUpdates,
  fetchManifest,
  stageRelease,
  parseManifest,
  compareVersions,
  deferredUpdate,
  onStateChange: (fn) => { onStateChange = fn; },
  FEED_URL,
};
