/*
 * Whether the update keeps asking.
 *
 * The report was "Windows users have to check manually" — and a manual check
 * worked, which is the whole clue. Three separate things made the *automatic*
 * offer go quiet, and only the first was fixed in 0.8.29:
 *
 *   1. The offer opened while the user was in another app, and Windows refuses
 *      the foreground to a process that does not already hold it — so it sat
 *      behind their work. A manual check is different only because the app has
 *      focus at that moment. (update-surface.js, test-update-surface.js.)
 *   2. One "Later" held forever. This is a tray app that never ends — closing
 *      the window backgrounds it — so a machine left on runs the same process
 *      for days, and the automatic offer never came back.
 *   3. `checking` was held across the wait for the user's answer, so an offer
 *      nobody answered latched it true for the life of the process and every
 *      later check, automatic and manual, returned immediately.
 *
 * Run with: npm run test:update-prompt
 */
const { app } = require('electron');

const updater = require('./updater');

let failures = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
};

const HOUR = 3600000;
const T0 = 1_000_000_000_000; // a fixed clock; the helper takes `now` so it can be one

setTimeout(() => { console.log('\nFAILED — timed out'); app.exit(1); }, 30000).unref();

app.whenReady().then(() => {
 try {
  const { shouldReoffer, REMIND_AFTER } = updater;

  /* ── nothing deferred ───────────────────────────────────────────── */
  check('a version nobody deferred is offered', shouldReoffer(null, '0.8.31', T0), true);

  /* ── a different version ────────────────────────────────────────── */
  // The deferral is per version: a newer release is a new question.
  check('a newer version is offered even right after a Later',
    shouldReoffer({ version: '0.8.30', at: T0 }, '0.8.31', T0), true);

  /* ── the same version, inside the window ────────────────────────── */
  check('the same version is held immediately after Later',
    shouldReoffer({ version: '0.8.31', at: T0 }, '0.8.31', T0), false);
  check('and still held an hour later',
    shouldReoffer({ version: '0.8.31', at: T0 }, '0.8.31', T0 + HOUR), false);

  /* ── and then it comes back ─────────────────────────────────────── */
  // The bug: this was `false` forever. A tray app runs for days, so "forever"
  // meant the automatic offer was gone until someone quit the app outright.
  check('it asks again once the reminder is due',
    shouldReoffer({ version: '0.8.31', at: T0 }, '0.8.31', T0 + REMIND_AFTER), true);
  check('and every check after that',
    shouldReoffer({ version: '0.8.31', at: T0 }, '0.8.31', T0 + REMIND_AFTER + HOUR), true);

  // A day of being left alone must not be quieter than three hours of it.
  check('a day later it is certainly still asking',
    shouldReoffer({ version: '0.8.31', at: T0 }, '0.8.31', T0 + 24 * HOUR), true);

  /* ── the reminder is a real interval, not a placeholder ─────────── */
  check('the reminder is hours, not milliseconds or days', REMIND_AFTER > HOUR && REMIND_AFTER <= 12 * HOUR, true);

  // With an hourly poll, a reminder shorter than the poll would mean asking on
  // every single tick — and one longer than a working day would lose the update
  // on a machine that is shut down each night.
  check('and it lands between one poll and one working day',
    REMIND_AFTER >= HOUR && REMIND_AFTER <= 8 * HOUR, true);

  /* ── the menu still names what was deferred ─────────────────────── */
  // deferredUpdate() feeds "Install Update x.y.z…" in both menus and the tray
  // tooltip, so it has to stay a bare version string now that the state behind
  // it is an object.
  check('nothing deferred reads as null', updater.deferredUpdate(), null);

  console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
  app.exit(failures ? 1 : 0);
 } catch (error) {
  console.log(`\nFAILED — ${error.message}`);
  app.exit(1);
 }
});
