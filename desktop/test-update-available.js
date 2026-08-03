/*
 * The "a new version is available" window: what it shows, that the disclosure
 * grows *and shrinks* the panel, and that every way out resolves show().
 *
 * The shrink is the one worth guarding. The first version measured .screen,
 * which min-height pins to the window — so the measurement could only ever
 * report the size the window already was. It grew fine and never collapsed.
 *
 * Run with: npm run test:update-available
 */
const { app, BrowserWindow } = require('electron');

const updateAvailable = require('./update-available');

const NOTES = [
  'Brand-blue title bar with Back, Forward and Reload built in',
  'Windows version, alongside macOS',
  'Notification sounds now play for every alert, not just messages',
  'A clearer message when the portal is briefly unavailable',
];

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
const check = (label, got, want) => {
  const ok = got === want;
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
};

// The last *live* window: a window that has just been closed can still be in
// the list, and running script in it rejects into a promise nobody is holding,
// which hangs the run instead of failing it.
const panel = () => BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed()).pop();
const height = () => panel().getContentSize()[1];
const js = (expr) => panel().webContents.executeJavaScript(expr, true);
const toggle = () => js("document.getElementById('disclosure').click(); void 0;");

setTimeout(() => { console.log('\nFAILED — timed out'); app.exit(1); }, 60000).unref();

app.whenReady().then(async () => {
 try {
  /* ── content, and the expand/collapse cycle ─────────────────────── */
  let choice = updateAvailable.show({ version: '9.9.9', notes: NOTES });
  await wait(1800);

  check('names the version on offer', await js("document.getElementById('subtitle').textContent"),
    'TM ANTOINE Portal 9.9.9');
  check('lists every note', await js("document.querySelectorAll('#notes li').length"), NOTES.length);
  check('starts collapsed', await js("document.getElementById('details').hidden"), true);

  const collapsed = height();

  await toggle(); await wait(500);
  const expanded = height();
  check('discloses the notes', await js("document.getElementById('details').hidden"), false);
  check('chevron turns down', await js("document.getElementById('disclosure').getAttribute('aria-expanded')"), 'true');
  check('label becomes Hide details', await js("document.getElementById('disclosure-label').textContent"), 'Hide details');
  check('panel grows to fit them', expanded > collapsed + 80, true);

  await toggle(); await wait(500);
  check('panel collapses back to where it started', height(), collapsed);

  // Twice, because one working cycle can be luck.
  await toggle(); await wait(500);
  check('second expand matches the first', height(), expanded);
  await toggle(); await wait(500);
  check('second collapse matches too', height(), collapsed);

  /* ── the ways out ──────────────────────────────────────────────── */
  await js("document.getElementById('update').click(); void 0;");
  check('Update Now resolves to update', await choice, 'update');

  choice = updateAvailable.show({ version: '9.9.9', notes: NOTES });
  await wait(1200);
  await js("document.getElementById('later').click(); void 0;");
  check('Later resolves to later', await choice, 'later');

  // Closing the window is a decision too; without it show() never settles and
  // the update silently hangs waiting for an answer that cannot come.
  choice = updateAvailable.show({ version: '9.9.9', notes: NOTES });
  await wait(1200);
  panel().close();
  check('closing the window counts as later', await choice, 'later');

  /* ── nothing to disclose ───────────────────────────────────────── */
  choice = updateAvailable.show({ version: '9.9.9', notes: [] });
  await wait(1200);
  // An empty drawer reads as a bug, so the control hides itself instead.
  check('no notes hides the disclosure', await js("getComputedStyle(document.getElementById('disclosure')).display"), 'none');
  updateAvailable.close();
  await choice;

  console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
  app.exit(failures ? 1 : 0);
 } catch (error) {
  console.log(`\nFAILED — ${error.message}`);
  app.exit(1);
 }
});
