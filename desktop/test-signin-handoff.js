/*
 * Verifies the sign-in verifier survives the process that created it.
 *
 * This is the regression behind "signing in just brings me back to the login
 * page". The browser leg always worked — the server recorded a login every
 * time — but the tmaportal:// reply landed in a process whose in-memory
 * verifier was null, and the claim was dropped without a word. Three staff
 * accounts logged in seven, seven and three times in a row that way and never
 * reached the portal once.
 *
 * What is under test is only the persistence, because that is the part that has
 * to be true in a *different* process than the one that wrote it.
 *
 * Run with: env -u ELECTRON_RUN_AS_NODE electron test-signin-handoff.js
 */
const { app } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const handoff = require('./signin-handoff');

let failures = 0;

function check(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: expected ${expected}, got ${actual}`);
}

setTimeout(() => {
  console.log('\nFAILED — timed out');
  app.exit(1);
}, 20000).unref();

// A throwaway directory, so the suite never touches the verifier of a real
// sign-in in flight on this machine.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tma-handoff-'));

app.whenReady().then(() => {
  check('nothing stored before a sign-in starts', handoff.stored(dir), null);

  handoff.remember(dir, 'verifier-one');
  check('the verifier is readable after being remembered', handoff.stored(dir), 'verifier-one');

  // The point of the whole exercise: a cold-started process has no module
  // state, only the file. Clearing the require cache is the closest this can
  // get to being a different process.
  delete require.cache[require.resolve('./signin-handoff')];
  const reloaded = require('./signin-handoff');
  check('and to a process that never wrote it', reloaded.stored(dir), 'verifier-one');

  // Single use — a redeemed token must not leave a verifier lying around.
  reloaded.forget(dir);
  check('forgetting clears it', reloaded.stored(dir), null);
  check('and forgetting again is harmless', (() => {
    reloaded.forget(dir);

    return reloaded.stored(dir);
  })(), null);

  // A new sign-in replaces the previous verifier rather than appending to it.
  reloaded.remember(dir, 'verifier-one');
  reloaded.remember(dir, 'verifier-two');
  check('a second sign-in replaces the first', reloaded.stored(dir), 'verifier-two');

  // The launch path must not throw on a machine where the directory cannot be
  // written; memory still covers the running app.
  check('an unwritable location reports failure instead of throwing',
    reloaded.remember(path.join('/proc', 'nope', 'nope'), 'x'), false);
  check('and reads back as nothing',
    reloaded.stored(path.join('/proc', 'nope', 'nope')), null);

  fs.rmSync(dir, { recursive: true, force: true });

  console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
  app.exit(failures ? 1 : 0);
});
