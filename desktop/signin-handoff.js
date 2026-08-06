/*
 * The PKCE verifier for the browser sign-in hand-off, and why it is on disk.
 *
 * Signing in happens in the user's real browser and comes back over the
 * tmaportal:// scheme carrying only a token. The token is worth nothing without
 * the verifier — that is the whole point — so the verifier has to still be here
 * when the reply lands. It used to live in a module variable, which held for the
 * common case and failed for the one that matters most:
 *
 *   Windows hands the URL back by re-launching the exe. Normally the
 *   single-instance lock routes that into the running app, which still has the
 *   verifier in memory. But a cold start — app not running, or the lock not
 *   routing — arrives in a *fresh* process where that variable is null, and the
 *   hand-off was dropped with no message at all. The browser leg had already
 *   succeeded, so the server recorded a login; the app just sat on its login
 *   page. From the outside that reads as "signing in puts me back on the login
 *   page", and trying again fails in exactly the same way.
 *
 * Persisting it is a real, small weakening of PKCE: someone who can read this
 * file and race a live token could redeem it. Weighed against that, the token is
 * single-use server-side and lives 120 seconds, the file is owner-only inside
 * userData, and anyone who can read it can read the session cookie beside it.
 */
const path = require('node:path');
const fs = require('node:fs');

const FILE = 'signin-verifier';

/*
 * `app.getPath('userData')` is only valid once Electron is ready, so the path is
 * resolved per call rather than at require time. The directory is passed in by
 * the caller so this module can be tested without an Electron app object.
 */
function fileIn(dir) {
  return path.join(dir, FILE);
}

/** Hold on to the verifier for the sign-in that is about to start. */
function remember(dir, verifier) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(fileIn(dir), verifier, { mode: 0o600 });

    return true;
  } catch {
    // Not fatal: the in-memory copy in main.js still covers a running app.
    return false;
  }
}

/** The verifier for the sign-in in flight, or null if there isn't one. */
function stored(dir) {
  try {
    return fs.readFileSync(fileIn(dir), 'utf8').trim() || null;
  } catch {
    return null;
  }
}

/** Single use: drop it once it has been handed to the claim. */
function forget(dir) {
  try {
    fs.rmSync(fileIn(dir), { force: true });
  } catch {
    // A stale file is overwritten by the next sign-in.
  }
}

module.exports = { remember, stored, forget };
