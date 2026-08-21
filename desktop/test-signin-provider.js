/*
 * Which social-redirect clicks hand off to the system browser.
 *
 * The regression behind the Windows "blank window on Sign in with Google" bug:
 * the asset cache leaves the sign-in page at address `/`, so treating only
 * `/auth/*` as signing-in let OAuth run inside Electron. Google refuses that,
 * and the splash overlay never came down.
 *
 * Run with: env -u ELECTRON_RUN_AS_NODE electron test-signin-provider.js
 */
const { app } = require('electron');
const { isSocialRedirect, signInProviderFor } = require('./signin-provider');

const ORIGIN = 'https://portal.tmantoinelaw.com';
const google = `${ORIGIN}/auth/social/google/redirect`;
const microsoft = `${ORIGIN}/auth/social/microsoft/redirect`;

let failures = 0;

function check(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

setTimeout(() => {
  console.log('\nFAILED — timed out');
  app.exit(1);
}, 10000).unref();

app.whenReady().then(() => {
  check('a google redirect is recognised', isSocialRedirect(google, ORIGIN), true);
  check('an unrelated portal path is not', isSocialRedirect(`${ORIGIN}/files`, ORIGIN), false);
  check('another origin is not', isSocialRedirect('https://evil.example/auth/social/google/redirect', ORIGIN), false);

  check('sign-in from /auth/login hands off google',
    signInProviderFor(google, `${ORIGIN}/auth/login`, ORIGIN), 'google');
  check('sign-in from /auth/login hands off microsoft',
    signInProviderFor(microsoft, `${ORIGIN}/auth/login`, ORIGIN), 'microsoft');

  // The asset-cache address-bar lie: login page shown at `/`.
  check('sign-in from / (redirect address lie) hands off',
    signInProviderFor(google, `${ORIGIN}/`, ORIGIN), 'google');
  check('sign-in from / with trailing query still hands off',
    signInProviderFor(google, `${ORIGIN}/?reset=1`, ORIGIN), 'google');

  check('forgot-password page still hands off',
    signInProviderFor(google, `${ORIGIN}/auth/forgot-password`, ORIGIN), 'google');

  // Settings "connect mailbox" must stay in-app.
  check('settings connect stays in-app',
    signInProviderFor(google, `${ORIGIN}/settings/integrations`, ORIGIN), null);
  check('dashboard stays in-app',
    signInProviderFor(google, `${ORIGIN}/files`, ORIGIN), null);
  check('desktop PKCE start is never re-handed-off',
    signInProviderFor(google, `${ORIGIN}/auth/desktop/start`, ORIGIN), null);

  console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
  app.exit(failures ? 1 : 0);
});
