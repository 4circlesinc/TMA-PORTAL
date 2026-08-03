/*
 * Drives the updating screen through every phase and reads back what it shows,
 * without downloading anything.
 *
 * Run with: npm run test:update-window
 * Add --watch to leave it on screen, stepping through the phases, to look at it.
 */
const { app } = require('electron');

const updateWindow = require('./update-window');

const WATCH = process.argv.includes('--watch');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;

function check(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

app.whenReady().then(async () => {
  const panel = updateWindow.show('9.9.9');
  await new Promise((r) => panel.webContents.once('did-finish-load', r));

  const read = () => panel.webContents.executeJavaScript(`
    new Promise((resolve) => requestAnimationFrame(() => resolve({
      title: document.title,
      caption: document.getElementById('caption').textContent,
      width: document.getElementById('fill').style.width,
      indeterminate: document.getElementById('track').classList.contains('is-indeterminate'),
      value: document.getElementById('track').getAttribute('aria-valuenow'),
    })))
  `, true);

  // The version is deliberately not on screen — one less thing to read — so it
  // has to still reach the window title, which is what VoiceOver announces.
  check('version reaches the window title', (await read()).title, 'Updating to 9.9.9');

  updateWindow.setPhase('downloading');
  updateWindow.setProgress(0.42);
  await wait(WATCH ? 1500 : 250);

  const downloading = await read();
  check('download: names a percentage', downloading.caption, 'Downloading 42%');
  check('download: bar matches it', downloading.width, '42%');
  check('download: bar is determinate', downloading.indeterminate, false);
  check('download: exposes the value', downloading.value, '42');

  // Rounding, not truncation — 0.999 must not read as "99%" then jump to done.
  updateWindow.setProgress(0.999);
  await wait(WATCH ? 1200 : 250);
  check('download: rounds to 100%', (await read()).caption, 'Downloading 100%');

  updateWindow.setPhase('installing');
  await wait(WATCH ? 2000 : 250);

  const installing = await read();
  check('install: says so', installing.caption, 'Installing');
  check('install: bar goes indeterminate', installing.indeterminate, true);
  // A stale percentage under an indeterminate bar is a lie a screen reader
  // would still read out.
  check('install: drops the stale value', installing.value, null);

  // Progress arriving late must not drag it back to a percentage.
  updateWindow.setProgress(0.5);
  await wait(WATCH ? 800 : 250);
  check('install: ignores late progress', (await read()).caption, 'Installing');

  updateWindow.setPhase('restarting');
  await wait(WATCH ? 2000 : 250);

  const restarting = await read();
  check('restart: says so', restarting.caption, 'Restarting');
  check('restart: stays indeterminate', restarting.indeterminate, true);

  check('close() really closes it', (updateWindow.close(), updateWindow.isOpen()), false);

  console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
  app.exit(failures ? 1 : 0);
});
