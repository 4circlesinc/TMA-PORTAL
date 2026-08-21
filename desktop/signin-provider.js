'use strict';

/*
 * Decide whether a social-redirect navigation is a *sign-in* (hand off to the
 * system browser) or a Settings "connect mailbox" (keep in-app).
 *
 * The address-bar check matters because the asset-cache protocol handler
 * follows redirects inside net.fetch, so a cold start at `/` that the server
 * sends to `/auth/login` still reports `/` — see asset-cache.js. Treating only
 * `/auth/*` as signing-in left those clicks running Google/Microsoft OAuth
 * inside Electron, which Google refuses and which left the splash overlay up.
 */

const SOCIAL_REDIRECT = /^\/auth\/social\/(google|microsoft)\/redirect\b/;

function isSocialRedirect(url, portalOrigin) {
  try {
    const parsed = new URL(url);
    return parsed.origin === portalOrigin && SOCIAL_REDIRECT.test(parsed.pathname);
  } catch {
    return false;
  }
}

/**
 * @param {string} url target of the navigation
 * @param {string} currentUrl address the window currently reports
 * @param {string} portalOrigin
 * @returns {'google'|'microsoft'|null}
 */
function signInProviderFor(url, currentUrl, portalOrigin) {
  if (!isSocialRedirect(url, portalOrigin)) return null;

  try {
    const from = new URL(currentUrl || '');
    if (from.origin !== portalOrigin) return null;

    const path = from.pathname;
    // `/` is the front door after a redirect the address bar never saw.
    // `/auth/desktop` is our own PKCE start/claim — never hand that off again.
    const signingIn = (path === '/' || path.startsWith('/auth/'))
      && !path.startsWith('/auth/desktop');
    if (!signingIn) return null;
  } catch {
    return null;
  }

  return new URL(url).pathname.match(SOCIAL_REDIRECT)[1];
}

module.exports = { isSocialRedirect, signInProviderFor, SOCIAL_REDIRECT };
