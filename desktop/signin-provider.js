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
 *
 * Getting-started and account-setup also live under `/auth/`, but those
 * buttons are mailbox connects for someone already signed in. Handing them
 * off to `/auth/desktop/start` skips Microsoft/Google consent entirely.
 */

const SOCIAL_REDIRECT = /^\/auth\/social\/(google|microsoft)\/redirect\b/;

const CONNECT_RETURNS = new Set([
  'getting-started',
  'connectors',
  'profile',
  'email',
  'calendar',
  'onboarding',
  'account-setup-email',
]);

function isSocialRedirect(url, portalOrigin) {
  try {
    const parsed = new URL(url);
    return parsed.origin === portalOrigin && SOCIAL_REDIRECT.test(parsed.pathname);
  } catch {
    return false;
  }
}

function isConnectPage(path) {
  return path === '/auth/getting-started'
    || path.startsWith('/auth/getting-started/')
    || path === '/auth/setup'
    || path.startsWith('/auth/setup/');
}

/**
 * Sync / return query params mark a mailbox connect, not a fresh sign-in.
 * Login and register omit them.
 *
 * @param {string} url
 */
function isConnectRedirect(url) {
  try {
    const params = new URL(url).searchParams;
    if (['sync_all', 'sync_email', 'sync_calendar', 'sync_onedrive', 'sync_sharepoint']
      .some((key) => params.has(key))) {
      return true;
    }
    return CONNECT_RETURNS.has(params.get('return') || '');
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
  if (isConnectRedirect(url)) return null;

  try {
    const from = new URL(currentUrl || '');
    if (from.origin !== portalOrigin) return null;

    const path = from.pathname;
    // `/` is the front door after a redirect the address bar never saw.
    // `/auth/desktop` is our own PKCE start/claim — never hand that off again.
    // Getting-started / account-setup are connect checklists, not sign-in.
    const signingIn = (path === '/' || path.startsWith('/auth/'))
      && !path.startsWith('/auth/desktop')
      && !isConnectPage(path);
    if (!signingIn) return null;
  } catch {
    return null;
  }

  return new URL(url).pathname.match(SOCIAL_REDIRECT)[1];
}

module.exports = {
  isSocialRedirect,
  isConnectRedirect,
  signInProviderFor,
  SOCIAL_REDIRECT,
};
