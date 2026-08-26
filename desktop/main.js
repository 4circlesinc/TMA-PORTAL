const {
  app, BrowserWindow, Menu, shell, session, dialog, nativeImage,
  ipcMain, systemPreferences, powerSaveBlocker, net, desktopCapturer,
} = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

/*
 * Electron/undici rejects HTTP header values with code points > 255
 * (ByteString). A Cookie or Referer carrying e.g. Turkish "ı" used to throw
 * an uncaught exception in the main process and show the "A JavaScript error
 * occurred" dialog. asset-cache sanitises the common path; this is the last
 * line of defence so one bad header cannot take the shell down.
 */
process.on('uncaughtException', (err) => {
  const message = err && err.message ? String(err.message) : String(err);
  if (/ByteString/i.test(message) || /greater than 255/i.test(message)) {
    console.error('[main] ignored non-Latin1 header error:', message);
    return;
  }
  console.error('[main] uncaughtException', err);
});

const HOST_BRIDGE = require('./host-bridge');
const updater = require('./updater');
const { installCloseToBackground } = require('./window-policy');
const callWindow = require('./call-window');
const titlebar = require('./titlebar');
const tray = require('./tray');
const badge = require('./badge');
const taskbarPin = require('./taskbar-pin');
const notifications = require('./notifications');
const splash = require('./splash');
const handoff = require('./signin-handoff');
const { isSocialRedirect, signInProviderFor } = require('./signin-provider');
const assetCache = require('./asset-cache');
const contextMenu = require('./context-menu');
const shellCache = require('./shell-cache');
const fileCache = require('./file-cache');
const settings = require('./settings');
// Our own version, not app.getVersion(): that reports Electron's own version
// whenever the app is started from a file rather than a package directory.
const { version: APP_VERSION } = require('./package.json');

// Which portal this shell talks to. Override for local work:
//   TMA_PORTAL_URL=http://localhost:8001 npm start
const PORTAL_URL = process.env.TMA_PORTAL_URL || 'https://portal.tmantoinelaw.com';
const PORTAL_ORIGIN = new URL(PORTAL_URL).origin;

const PROTOCOL = 'tmaportal';

const IS_MAC = process.platform === 'darwin';

// Identity providers, for the one flow that still runs in-app: connecting a
// mailbox or calendar from Settings, where the session already belongs to a
// signed-in user. Signing in goes through the system browser instead.
const AUTH_HOSTS = [
  'accounts.google.com',
  'login.microsoftonline.com',
  'login.live.com',
  'oauth.googleusercontent.com',
];

const isAuthUrl = (url) => {
  try {
    return AUTH_HOSTS.includes(new URL(url).hostname);
  } catch {
    return false;
  }
};

const isPortalUrl = (url) => {
  try {
    return new URL(url).origin === PORTAL_ORIGIN;
  } catch {
    return false;
  }
};

/* ---------------------------------------------------------------- window state */

const statePath = () => path.join(app.getPath('userData'), 'window-state.json');

function readWindowState() {
  try {
    const saved = JSON.parse(fs.readFileSync(statePath(), 'utf8'));
    if (Number.isFinite(saved.width) && Number.isFinite(saved.height)) return saved;
  } catch {
    // first run, or the file got mangled, fall through to defaults
  }
  return { width: 1440, height: 900 };
}

function saveWindowState(win) {
  if (!win || win.isDestroyed() || win.isMinimized()) return;
  try {
    fs.writeFileSync(statePath(), JSON.stringify(win.getNormalBounds()));
  } catch {
    // losing window position is not worth surfacing to the user
  }
}

/* ------------------------------------------------------------------ user agent */

// Google refuses OAuth from anything that self-identifies as an embedded
// webview, so we present as plain Chrome.
function chromeUserAgent() {
  return app.userAgentFallback
    .replace(/\sElectron\/[\d.]+/, '')
    .replace(new RegExp(`\\s${app.getName()}\\/[\\d.]+`), '');
}

/* ----------------------------------------------------------------------- window */

let mainWindow = null;
let loadingLayer = null;

// Closing the window puts the app in the background rather than ending it, so
// messages and calls keep arriving. Only Quit, or an update restart, sets
// this, and only then is the window really allowed to go.
let quitting = false;

function createWindow() {
  const state = readWindowState();

  mainWindow = new BrowserWindow({
    ...state,
    minWidth: 960,
    minHeight: 640,
    show: false,
    /*
     * Painted before the first frame arrives, so the window opens in brand
     * colour rather than flashing white on its way to the portal.
     *
     * The splash's surface, not the brand blue it used to be: the loading layer
     * is the very next thing drawn, and when the two differed the window opened
     * bright blue and immediately went dark. One colour from the first frame to
     * the portal.
     */
    backgroundColor: splash.SURFACE,
    title: 'TM ANTOINE Portal',
    // Hides the native bar so titlebar.js can draw a blue one in its place.
    ...titlebar.windowOptions(),
    ...(IS_MAC ? {} : { icon: path.join(__dirname, 'assets', 'icon.ico') }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true,
      // Chromium throttles timers to a crawl in hidden windows. A hidden
      // window is this app's normal state, and the websocket heartbeat and
      // badge refresh both live in there.
      backgroundThrottling: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());

  /*
   * Right-click does something.
   *
   * Electron ships no context menu at all, so until now it did nothing
   * anywhere in the app, no Copy, no Paste, and no way to reach a single one
   * of the spelling suggestions `spellcheck: true` above has been generating
   * all along. Attached per window rather than per session so a call window
   * or the update window can decide for itself.
   */
  contextMenu.install(mainWindow.webContents);

  installCloseToBackground(
    mainWindow,
    () => quitting || !settings.get('backgroundOnClose'),
    () => saveWindowState(mainWindow),
  );

  mainWindow.on('closed', () => { mainWindow = null; });

  /*
   * The loading layer goes up before anything is asked for, and comes down only
   * once the page underneath has painted, so the staged assembly of the shell
   * (sidebar, then labels, then icons) happens out of sight.
   */
  loadingLayer = splash.attach(mainWindow);
  loadingLayer.show();

  attachNavigationRules(mainWindow);
  loadPortal(mainWindow);
}

function loadPortal(win, url = PORTAL_URL) {
  win.loadURL(url, { userAgent: chromeUserAgent() }).catch(() => {
    // handled by did-fail-load
  });
}

/**
 * Takes the loading layer down once the page underneath has actually painted.
 *
 * `did-finish-load` is far too early to reveal on: it fires when the document
 * and its subresources have loaded, which is before layout has settled and
 * before webfonts have swapped. Revealing there is what produced the staged
 * assembly, shell, then labels, then icons, that made the app look like a
 * page being built rather than an app opening.
 *
 * So it waits for the load event, then for the fonts (they reshape every label
 * on the screen, and swapping after the reveal shows the page twice in two
 * typefaces), then for the DOM to go quiet.
 *
 * That last one is what actually matters. The portal fetches its data *after*
 * the page has loaded and renders it when the answers arrive, so waiting only
 * for paint revealed a shell with no labels and a column of skeletons, icons
 * present, content still on its way. Quiescence is the only honest signal that
 * the screen has finished assembling, since nothing in the page announces it.
 */
async function revealWhenPainted(webContents) {
  if (!loadingLayer) return;

  try {
    await webContents.executeJavaScript(`
      new Promise((resolve) => {
        // Capped, because a page that never stops moving, a spinner, a live
        // clock, would otherwise hold the screen for ever.
        const CAP = 6000;
        const QUIET = 350;

        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        };

        const cap = setTimeout(finish, CAP);

        const waitForQuiet = () => {
          let idle = setTimeout(settled, QUIET);
          const observer = new MutationObserver(() => {
            clearTimeout(idle);
            idle = setTimeout(settled, QUIET);
          });

          function settled() {
            observer.disconnect();
            clearTimeout(cap);
            finish();
          }

          observer.observe(document.documentElement, {
            childList: true, subtree: true, characterData: true,
          });
        };

        const ready = () => {
          if (document.fonts && document.fonts.ready) {
            document.fonts.ready.then(waitForQuiet, waitForQuiet);
          } else waitForQuiet();
        };

        if (document.readyState === 'complete') ready();
        else window.addEventListener('load', ready, { once: true });
      })
    `, true);
  } catch {
    // The page went away mid-wait; the layer's own timeout still takes it down.
  }

  if (loadingLayer) loadingLayer.hide();
}

function revealWindow({ steal }) {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (steal) {
    mainWindow.show();
    // `steal` is a macOS-only option; on Windows the window itself has to be
    // focused, and a flashing taskbar button has to be told to stop.
    if (IS_MAC) app.focus({ steal: true });
    else {
      mainWindow.flashFrame(false);
      mainWindow.focus();
    }
  } else if (!mainWindow.isVisible()) {
    // A ringing call should surface without yanking the keyboard away from
    // whatever the user is typing in another app.
    mainWindow.showInactive();
  }
}

function attachNavigationRules(win) {
  const { webContents } = win;

  webContents.setWindowOpenHandler(({ url, disposition }) => {
    // A call popping out into its own floating window (see call-window.js).
    // Checked first: the fallback below would post `about:blank` to the system
    // browser and deny the window the call is trying to move into.
    if (callWindow.isPictureInPictureRequest({ url, disposition })) {
      return { action: 'allow' };
    }

    const provider = signInProviderFor(url, webContents.getURL(), PORTAL_ORIGIN);
    if (provider) {
      startBrowserSignIn(provider);
      return { action: 'deny' };
    }

    // Connecting a mailbox from Settings: the session is already ours, so keep
    // it in-app in a child window that shares our cookies.
    if (isAuthUrl(url) || isSocialRedirect(url, PORTAL_ORIGIN)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 520,
          height: 700,
          parent: win,
          autoHideMenuBar: true,
          webPreferences: { contextIsolation: true, nodeIntegration: false },
        },
      };
    }

    if (!isPortalUrl(url)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }

    return { action: 'allow' };
  });

  webContents.on('will-navigate', (event, url) => {
    const provider = signInProviderFor(url, webContents.getURL(), PORTAL_ORIGIN);
    if (provider) {
      event.preventDefault();
      startBrowserSignIn(provider);
      return;
    }

    // Top-level navigation away from the portal goes to the browser instead.
    if (isPortalUrl(url) || isAuthUrl(url)) return;
    event.preventDefault();
    shell.openExternal(url);
  });

  /*
   * A reload has the same problem as a cold start, so the layer returns for
   * every main-frame navigation. `isSameDocument` is excluded: the portal
   * routes by pushState, and covering the window for an in-page move would
   * flash the splash over a screen that is already there.
   */
  webContents.on('did-start-navigation', (event, url, isSameDocument, isMainFrame) => {
    if (!isMainFrame || isSameDocument || !loadingLayer) return;
    // Local waiting / error pages are the content, covering them with the
    // blue splash is what made sign-in look like a blank window.
    if (url.startsWith('file:') || url.startsWith('data:')) return;
    loadingLayer.show();
  });

  webContents.on('did-finish-load', () => {
    // Before the portal check: the error page below is ours too, and it would
    // otherwise render underneath the bar.
    titlebar.apply(webContents);

    const current = webContents.getURL();
    if (!isPortalUrl(current)) {
      applyBadge(0);
      applyCallPhase('');
      // Non-portal finishes (blocked IdP pages, etc.) used to return without
      // taking the splash down, the window stayed brand-blue / "blank".
      if (loadingLayer) loadingLayer.hide();
      return;
    }
    webContents.executeJavaScript(HOST_BRIDGE, true).catch(() => {
      // A page that never exposed the stores just leaves the badge alone.
    });

    // Auth screens are plain forms, no shell to assemble, so reveal as soon
    // as the document is in. Waiting for quiescence left the splash covering
    // Forgot password / login long enough to read as a blank window.
    // Do not treat `/` here: that is also the signed-in front door, and it
    // still needs the painted reveal so the shell does not assemble on screen.
    try {
      const path = new URL(current).pathname;
      if (path.startsWith('/auth/') && !path.startsWith('/auth/desktop')) {
        if (loadingLayer) loadingLayer.hide();
        return;
      }
    } catch {
      // fall through to the painted reveal
    }

    revealWhenPainted(webContents);
  });

  // The portal routes through pushState, which fires no load event. Without
  // this the bar survives the first screen and disappears on the second.
  // pushState only moves within the same document, so the stylesheet is still
  // there, only the bar's Back/Forward state needs redrawing.
  webContents.on('did-navigate-in-page', () => titlebar.refresh(webContents));

  webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame) return;
    // -3 = aborted. Social sign-in preventDefault still raises the splash on
    // did-start-navigation; leaving it up is the "blank window" on Windows.
    if (errorCode === -3) {
      if (loadingLayer) loadingLayer.hide();
      return;
    }
    // The error page is the thing to look at; hiding it behind a logo helps
    // nobody.
    if (loadingLayer) loadingLayer.hide();

    // Being offline is not a failure worth a URL and an error code. If we had
    // a shell to paint we would already have painted it, so this is the honest
    // remaining case: nothing kept, and nothing to reach.
    if (isOfflineError(errorCode)) {
      showOffline(win);

      return;
    }

    showLoadError(win, errorDescription, validatedURL);
  });

  /*
   * A 5xx is a *successful* load as far as Chromium is concerned, bytes were
   * asked for and bytes arrived, so did-fail-load never sees it and the body
   * renders as the page. When the portal is between containers that body is the
   * proxy's own, and the window fills with "upstream connect error or
   * disconnect/reset before headers… connection refused", which reads like the
   * app is broken rather than the server being briefly away.
   */
  webContents.on('did-navigate', async (_event, url, httpResponseCode, httpStatusText) => {
    if (httpResponseCode < 500) return;

    /*
     * A 502 from the asset-cache handler is its own name for "no answer at
     * all", the reader is offline, not looking at an unwell server. Telling
     * someone on a train that the portal is restarting sends them to check a
     * status page that is also unreachable.
     */
    if (await looksOffline()) {
      showOffline(win);

      return;
    }

    showLoadError(
      win,
      'The portal is temporarily unavailable, it may be restarting. '
      + `(${httpResponseCode}${httpStatusText ? ` ${httpStatusText}` : ''})`,
      url,
    );
  });

  // An auth child window that lands back on the portal has done its job.
  app.on('browser-window-created', (_event, child) => {
    if (child === win) return;
    child.webContents.on('will-redirect', (_e, url) => {
      if (!isPortalUrl(url)) return;
      child.close();
      loadPortal(win, url);
    });
  });
}

/*
 * net::ERR_* codes that mean "there is no network", as distinct from "the
 * network answered and the answer was bad".
 */
const OFFLINE_ERRORS = new Set([
  -21,  // NETWORK_CHANGED
  -100, // CONNECTION_CLOSED
  -101, // CONNECTION_RESET
  -102, // CONNECTION_REFUSED
  -104, // CONNECTION_FAILED
  -105, // NAME_NOT_RESOLVED
  -106, // INTERNET_DISCONNECTED
  -109, // ADDRESS_UNREACHABLE
  -118, // CONNECTION_TIMED_OUT
  -137, // NAME_RESOLUTION_FAILED
  -324, // EMPTY_RESPONSE
]);

function isOfflineError(code) {
  return OFFLINE_ERRORS.has(code);
}

/** Can we reach the portal at all right now? */
async function looksOffline() {
  try {
    const res = await net.fetch(new URL('/up', PORTAL_URL).toString(), {
      bypassCustomProtocolHandlers: true,
    });

    // The handler's marker survives here too; a real /up says 200.
    return !res.ok;
  } catch {
    return true;
  }
}

/*
 * The offline screen.
 *
 * Deliberately not an error: no URL, no net::ERR code, no red. The reader did
 * nothing wrong and there is nothing for them to fix, they are somewhere
 * without a connection, and the app's job is to say so plainly and get out of
 * the way. It retries on its own when the machine comes back online, so the
 * common case needs no click at all.
 */
function showOffline(win) {
  const page = `
    <meta charset="utf-8">
    <style>
      body { font: 15px/1.6 -apple-system, "Segoe UI", system-ui, sans-serif; color: #1c1c1c;
             display: grid; place-content: center; justify-items: center; height: 100vh;
             margin: 0; text-align: center; gap: 10px; background: #fff; padding: 24px; }
      .dot { width: 10px; height: 10px; border-radius: 50%; background: #9a9a9a; margin-bottom: 6px; }
      h1 { font-size: 17px; margin: 0; font-weight: 600; }
      p { margin: 0; color: #6b6b6b; max-width: 30rem; }
      button { font: inherit; padding: 8px 18px; border-radius: 8px; border: 1px solid #ddd;
               background: #1c1c1c; color: #fff; cursor: pointer; margin-top: 10px; }
      @media (prefers-color-scheme: dark) {
        body { background: #141414; color: #f2f2f2; } p { color: #9a9a9a; }
        button { background: #f2f2f2; color: #141414; border-color: #333; }
      }
    </style>
    <div class="dot"></div>
    <h1>You're offline</h1>
    <p>The portal will open again on its own as soon as you have a connection.
       Anything you changed on this device is saved and will be sent then.</p>
    <button onclick="location.href='${PORTAL_URL}'">Try now</button>
    <script>
      // Come back by itself. A reader who walks out of the tunnel should find
      // the portal, not a button they have to notice.
      addEventListener('online', () => { location.href = '${PORTAL_URL}'; });
      setInterval(() => { if (navigator.onLine) location.href = '${PORTAL_URL}'; }, 5000);
    </script>
  `;
  win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(page)}`);
}

function showLoadError(win, description, url) {
  const page = `
    <meta charset="utf-8">
    <style>
      body { font: 15px/1.5 -apple-system, "Segoe UI", system-ui, sans-serif; color: #1c1c1c;
             display: grid; place-content: center; height: 100vh; margin: 0;
             text-align: center; gap: 12px; background: #fff; }
      h1 { font-size: 17px; margin: 0; }
      p { margin: 0; color: #6b6b6b; max-width: 34rem; }
      code { font-size: 13px; color: #999; }
      button { font: inherit; padding: 8px 18px; border-radius: 8px; border: 1px solid #ddd;
               background: #1c1c1c; color: #fff; cursor: pointer; margin-top: 8px; }
      @media (prefers-color-scheme: dark) {
        body { background: #141414; color: #f2f2f2; } p { color: #9a9a9a; }
        button { background: #f2f2f2; color: #141414; border-color: #333; }
      }
    </style>
    <h1>Can't reach the portal</h1>
    <p>${description}</p>
    <code>${url}</code>
    <button onclick="location.href='${PORTAL_URL}'">Try again</button>
  `;
  win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(page)}`);
}

/* --------------------------------------------------------------- sign-in handoff
 *
 * Google refuses OAuth inside an embedded webview, so signing in happens in the
 * user's real browser and comes back over the tmaportal:// scheme. Any app on
 * the machine can claim that scheme, so the reply carries only a token, worth
 * nothing without the verifier, which never leaves here. The server half is
 * app/Http/Controllers/DesktopAuthController.php.
 *
 * Which clicks count as sign-in (vs Settings "connect") lives in
 * signin-provider.js, including the `/` address-bar lie from the asset cache.
 */

const base64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

let pendingVerifier = null;

/*
 * The system-browser URL opened for the current handoff. Kept here (not on the
 * page) so "Open in browser" can re-fire it without giving the portal a general
 * openExternal privilege.
 */
let pendingBrowserSignInUrl = null;

/*
 * The verifier also goes to disk, because it has to outlive the process that
 * created it, see signin-handoff.js for the Windows cold start that made a
 * successful sign-in look like being dumped back on the login page.
 */
const verifierDir = () => app.getPath('userData');

function rememberVerifier(verifier) {
  pendingVerifier = verifier;
  handoff.remember(verifierDir(), verifier);
}

function storedVerifier() {
  return pendingVerifier || handoff.stored(verifierDir());
}

function forgetVerifier() {
  pendingVerifier = null;
  pendingBrowserSignInUrl = null;
  handoff.forget(verifierDir());
}

function providerLabel(provider) {
  if (provider === 'google') return 'Google';
  if (provider === 'microsoft') return 'Microsoft';
  return '';
}

/**
 * White waiting screen (same shape as /auth/desktop/finish) while the system
 * browser does the OAuth. Replaces the blue splash that used to sit over a
 * half-aborted navigation and read as a blank window.
 */
function showSignInWaiting(browserUrl, provider) {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  pendingBrowserSignInUrl = browserUrl;
  if (loadingLayer) loadingLayer.hide();

  mainWindow.loadFile(path.join(__dirname, 'signin-waiting.html'), {
    query: {
      provider: providerLabel(provider),
    },
  }).catch(() => {
    // If the waiting page itself fails, at least leave the splash down.
  });
}

function startBrowserSignIn(provider) {
  const verifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
  rememberVerifier(verifier);

  const url = new URL('/auth/desktop/start', PORTAL_ORIGIN);
  url.searchParams.set('challenge', challenge);
  if (provider) url.searchParams.set('provider', provider);

  const browserUrl = url.toString();
  shell.openExternal(browserUrl);
  showSignInWaiting(browserUrl, provider);
}

function claimBrowserSession(deepLink) {
  let token = null;
  try {
    token = new URL(deepLink).searchParams.get('token');
  } catch {
    return;
  }

  if (!token) return;

  const verifier = storedVerifier();

  // A hand-off we cannot complete must say so. Silently returning here is what
  // made this look like "signing in just puts me back on the login page": the
  // browser leg succeeded every time, so the server recorded a login, and the
  // app gave no hint that the last step never happened.
  if (!verifier) {
    if (mainWindow) revealWindow({ steal: true });
    dialog.showMessageBox(mainWindow ?? undefined, {
      type: 'warning',
      title: 'Sign-in could not be completed',
      message: 'That sign-in could not be completed.',
      detail: 'Start signing in from this window rather than from the browser, and finish in the tab it opens.',
      buttons: ['OK'],
    });

    return;
  }

  if (!mainWindow) return;

  const url = new URL('/auth/desktop/claim', PORTAL_ORIGIN);
  url.searchParams.set('token', token);
  url.searchParams.set('verifier', verifier);
  forgetVerifier();

  revealWindow({ steal: true });
  loadPortal(mainWindow, url.toString());
}

/* ----------------------------------------------------------------- unread badge */

/**
 * Which count the taskbar is being asked to show. Drawing is a round trip into
 * the renderer, so two counts arriving close together can come back in either
 * order, and the loser would be the one left on screen. Anything that returns
 * to find the number has moved on drops its result.
 */
let badgeWanted = 0;

/**
 * Windows has no dock badge; the count is stamped over the taskbar button as an
 * overlay icon instead. badge.js explains why drawing it is not as simple as
 * handing over an image.
 */
async function taskbarOverlay(count) {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  if (count <= 0) {
    mainWindow.setOverlayIcon(null, '');
    return;
  }

  const icon = await badge.image(mainWindow.webContents, count);

  if (!icon || count !== badgeWanted) return;
  if (!mainWindow || mainWindow.isDestroyed()) return;

  mainWindow.setOverlayIcon(icon, `${badge.label(count)} unread`);
}

function applyBadge(count) {
  // Full total on dock / taskbar, do not clamp to 99 or 999.
  const n = Number.isFinite(count) && count > 0 ? Math.round(count) : 0;

  if (IS_MAC) {
    app.setBadgeCount(n);
    return;
  }

  badgeWanted = n;

  // Deliberately not awaited: the badge is not worth holding anything up for,
  // and every failure inside is already handled by leaving the last one alone.
  taskbarOverlay(n).catch(() => {});

  tray.setTooltipCount(n);
}

/* ----------------------------------------------------------------------- calling
 *
 * messaging-calls.js publishes the phase; the shell supplies what a web page
 * cannot: a ring panel that floats over everything without opening the app, a
 * dock that keeps bouncing until the call is dealt with, and a display that
 * does not sleep mid-call.
 */

let bounceId = null;
let powerBlockerId = null;

/** Who is calling, straight from the page, see publishCallPhase(). */
/**
 * The caller's photo, as a data: URI the ring panel can actually display.
 *
 * The panel is a local file, and the portal publishes avatars as root-relative
 * paths, so handing it "/media/avatars/x.jpg" resolves to file:///media/... and
 * quietly fails, leaving the initials. Making the URL absolute is not enough
 * either: that route is behind auth, and the session cookie is SameSite=Lax, so
 * a file:// page requesting it is a cross-site subresource and sends no cookie.
 * It would 302 to the sign-in page and the image would fail anyway.
 *
 * Fetching here sidesteps both: the main process has the session, and a data:
 * URI carries no origin of its own. Anything that goes wrong returns empty,
 * which is the initials the panel already falls back to.
 */
async function avatarDataUri(raw) {
  if (!raw || typeof raw !== 'string') return '';
  if (raw.startsWith('data:')) return raw;

  let url;
  try {
    url = new URL(raw, PORTAL_ORIGIN).toString();
  } catch {
    return '';
  }

  // Somewhere else entirely, a provider photo on its own CDN, say. Those need
  // no session, so the panel can load them directly.
  if (!isPortalUrl(url)) return url;

  try {
    const response = await net.fetch(url, { session: session.defaultSession, credentials: 'include' });
    if (!response.ok) return '';

    const type = response.headers.get('content-type') || '';
    // An expired session answers with the sign-in page, not a 401.
    if (!type.startsWith('image/')) return '';

    const bytes = Buffer.from(await response.arrayBuffer());
    // A ring panel is 300px wide; anything this large is a mistake, and the
    // data URI has to travel over IPC.
    if (bytes.length > 3_000_000) return '';

    return `data:${type};base64,${bytes.toString('base64')}`;
  } catch {
    return '';
  }
}

async function readCallInfo() {
  const fallback = { name: 'Incoming call', avatar: '', media: 'audio' };
  if (!mainWindow) return fallback;

  try {
    const raw = await mainWindow.webContents.executeJavaScript(
      "document.documentElement.getAttribute('data-tma-call-info')", true,
    );
    if (!raw) return fallback;

    const info = { ...fallback, ...JSON.parse(raw) };
    return { ...info, avatar: await avatarDataUri(info.avatar) };
  } catch {
    return fallback;
  }
}

async function ringPanel() {
  // The app is already in front: the page's own call UI is right there, and a
  // second panel on top of it would just be in the way.
  if (mainWindow && mainWindow.isVisible() && mainWindow.isFocused()) return;

  if (!settings.get('ringPanel')) {
    revealWindow({ steal: false });
    return;
  }

  callWindow.show(await readCallInfo());
}

function answerCall() {
  callWindow.close();
  if (!mainWindow) return;
  // Forward first, then answer, not the other way round. Answering opens the
  // call's own floating window, and a browser will not hand one to a page that
  // is not on screen. The call then floats above whatever the user goes back
  // to, which is the point of it having a window at all.
  revealWindow({ steal: true });
  // `true` is the user-gesture flag: this really was a click, on the ring
  // panel, and a floating window can only be asked for from one.
  mainWindow.webContents.executeJavaScript('window.TMAMessagingCalls.accept(true)', true).catch(() => {});
}

function declineCall() {
  callWindow.close();
  if (!mainWindow) return;
  mainWindow.webContents.executeJavaScript('window.TMAMessagingCalls.decline()', true).catch(() => {});
}

function applyCallPhase(phase) {
  if (phase === 'ringing') {
    ringPanel();

    if (IS_MAC && bounceId == null) {
      // 'critical' bounces until the app is activated, the whole point of a
      // ring you can hear from another Space.
      bounceId = app.dock.bounce('critical');
    } else if (!IS_MAC && mainWindow && !mainWindow.isDestroyed()) {
      // Windows has no dock to bounce; the taskbar button flashes instead, and
      // keeps flashing until the window is brought forward.
      mainWindow.flashFrame(true);
    }
  } else {
    // Answered elsewhere, cancelled, or over.
    callWindow.close();

    if (bounceId != null) {
      if (IS_MAC) app.dock.cancelBounce(bounceId);
      bounceId = null;
    }
    if (!IS_MAC && mainWindow && !mainWindow.isDestroyed()) mainWindow.flashFrame(false);
  }

  const onCall = phase === 'ringing' || phase === 'active';

  if (onCall && powerBlockerId == null) {
    powerBlockerId = powerSaveBlocker.start('prevent-display-sleep');
  } else if (!onCall && powerBlockerId != null) {
    powerSaveBlocker.stop(powerBlockerId);
    powerBlockerId = null;
  }
}

/* ------------------------------------------------------------------ permissions */

/*
 * macOS gates camera and microphone behind TCC, and an Electron app has to ask
 * for itself, the web permission grant alone leaves getUserMedia failing with
 * no device. Asked once; the answer is remembered by the OS.
 */
async function ensureMediaAccess() {
  if (!IS_MAC) return true;

  const granted = await Promise.all(['microphone', 'camera'].map(async (kind) => {
    if (systemPreferences.getMediaAccessStatus(kind) === 'granted') return true;
    try {
      return await systemPreferences.askForMediaAccess(kind);
    } catch {
      return false;
    }
  }));

  return granted.every(Boolean);
}

function applyPermissionPolicy() {
  const allowed = ['media', 'notifications', 'clipboard-sanitized-write', 'fullscreen', 'idle-detection'];

  session.defaultSession.setPermissionRequestHandler(async (webContents, permission, callback) => {
    if (!isPortalUrl(webContents.getURL()) || !allowed.includes(permission)) {
      return callback(false);
    }

    if (permission === 'media') {
      return callback(await ensureMediaAccess());
    }

    callback(true);
  });

  // getUserMedia and enumerateDevices consult this rather than the request
  // handler; without it, device labels come back empty and calls fail silently.
  session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
    const url = webContents ? webContents.getURL() : '';
    return isPortalUrl(url) && allowed.includes(permission);
  });

  /*
   * getDisplayMedia, screen sharing in calls. A browser shows its own
   * picker; Electron shows NOTHING unless the app answers this handler, so
   * without it Share Screen rejected before any picker existed and the
   * button read as dead in the desktop app while working fine on the web.
   * macOS 15+ gets the native system picker; everywhere else the primary
   * screen is granted directly, the call UI's own Stop control (and the
   * OS capture indicator) still govern the share.
   *
   * On a Mac the first capture attempt makes the OS itself ask for Screen
   * Recording permission ("would like to record this computer's screen").
   * A previously-denied state never re-prompts, so that case gets an
   * explanation and the exact System Settings pane instead of a share that
   * silently fails or records black frames.
   */
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    const deny = () => { try { callback(null); } catch { /* already answered */ } };
    try {
      const url = request && request.frame ? request.frame.url : '';
      if (!isPortalUrl(url)) return deny();

      if (process.platform === 'darwin') {
        const status = systemPreferences.getMediaAccessStatus('screen');
        if (status === 'denied' || status === 'restricted') {
          explainScreenPermission();
          return deny();
        }
        // 'not-determined': carry on, getSources below is what makes the
        // OS show its permission prompt, which is the ask the user expects.
      }

      const sources = await desktopCapturer.getSources({ types: ['screen'] });
      if (!sources.length) return deny();
      callback({ video: sources[0] });
    } catch (err) {
      console.error('[main] screen share failed:', err && err.message ? err.message : err);
      deny();
    }
  }, { useSystemPicker: true });
}

/* One dialog at a time, mashing Share Screen must not stack alerts. */
let screenPermissionDialogOpen = false;

function explainScreenPermission() {
  if (screenPermissionDialogOpen) return;
  screenPermissionDialogOpen = true;
  dialog.showMessageBox(mainWindow, {
    type: 'info',
    message: 'Allow screen recording to share your screen',
    detail: 'macOS is blocking screen sharing for this app. In System Settings, '
      + 'turn on Screen Recording for TM ANTOINE Portal, then quit and reopen '
      + 'the app, macOS only applies the change on a fresh start.',
    buttons: ['Open System Settings', 'Not now'],
    defaultId: 0,
    cancelId: 1,
  }).then(({ response }) => {
    if (response === 0) {
      shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
    }
  }).finally(() => { screenPermissionDialogOpen = false; });
}

/* ------------------------------------------------------------------------- menu */

/** Where ⌘1…⌘9 go. Paths are the portal's own, served as real pages. */
const PLACES = [
  { label: 'Home', path: '/' },
  { label: 'Messages', path: '/social/messages' },
  { label: 'Email', path: '/email' },
  { label: 'Files', path: '/folders/all' },
  { label: 'Calendar', path: '/calendar' },
  { label: 'Clients', path: '/clients' },
  { label: 'People', path: '/people' },
  { label: 'Signatures', path: '/signatures' },
];

function go(to) {
  if (!mainWindow) return;
  revealWindow({ steal: true });
  loadPortal(mainWindow, new URL(to, PORTAL_ORIGIN).toString());
}

const history = () => mainWindow && mainWindow.webContents.navigationHistory;

async function signOutOfThisDevice() {
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'question',
    buttons: ['Cancel', 'Clear Session'],
    defaultId: 1,
    cancelId: 0,
    message: `Clear the saved session on this ${IS_MAC ? 'Mac' : 'PC'}?`,
    detail: 'You will be asked to sign in again the next time you open the app.',
  });

  if (response !== 1) return;

  await session.defaultSession.clearStorageData({ storages: ['cookies', 'localstorage'] });
  loadPortal(mainWindow);
}

/**
 * Appears in more than one menu, so it is built rather than repeated. Reads
 * "Restart to Update" once a download is waiting, because at that point
 * checking again is not what the user wants.
 */
function checkForUpdatesItem() {
  return {
    label: updater.deferredUpdate()
      ? `Install Update ${updater.deferredUpdate()}…`
      : 'Check for Updates…',
    enabled: app.isPackaged,
    click: () => updater.checkForUpdates({ silent: false }),
  };
}

/** A checkbox that writes straight through to settings.js. */
function toggle(label, key, detail) {
  return {
    label,
    type: 'checkbox',
    checked: settings.get(key),
    toolTip: detail,
    click: (item) => {
      settings.set(key, item.checked);
      buildMenu(); // keep every copy of the checkbox honest
    },
  };
}

/**
 * The three app preferences, as a submenu. Lives under the app menu on macOS
 * and under File on Windows, where there is no app menu to put it in.
 */
function appSettingsMenu() {
  return {
    label: 'Desktop App Settings',
    submenu: [
      toggle('Launch at Login', 'launchAtLogin',
        `Start the portal when you log in to this ${IS_MAC ? 'Mac' : 'PC'}.`),
      toggle('Keep Running When Window Closes', 'backgroundOnClose',
        IS_MAC
          ? 'Closing the window keeps messages and calls arriving. Off makes the red button quit.'
          : 'Closing the window keeps messages and calls arriving in the notification area. Off makes the X quit.'),
      toggle('Ring Calls in a Separate Window', 'ringPanel',
        'Incoming calls appear in a small panel instead of opening the app.'),
      { type: 'separator' },
      { label: `Version ${APP_VERSION}`, enabled: false },
      checkForUpdatesItem(),
    ],
  };
}

function buildMenu() {
  // `role: 'appMenu'` and everything under it, services, hide, hideOthers,
  // unhide, exist only on macOS. Windows convention puts About and Quit at
  // the bottom of File and settings alongside them, so the two platforms get
  // genuinely different first menus rather than a Mac menu with holes in it.
  const macAppMenu = {
    role: 'appMenu',
    submenu: [
      { role: 'about' },
      checkForUpdatesItem(),
      { type: 'separator' },
      {
        // Named for what it opens. The submenu below is this app's own
        // settings, and two items called "Settings" is one too many.
        label: 'Portal Settings…',
        accelerator: 'CmdOrCtrl+,',
        click: () => go('/account-settings'),
      },
      appSettingsMenu(),
      { type: 'separator' },
      { role: 'services' },
      { type: 'separator' },
      { role: 'hide' },
      { role: 'hideOthers' },
      { role: 'unhide' },
      { type: 'separator' },
      { role: 'quit' },
    ],
  };

  const fileMenu = {
    label: 'File',
    submenu: [
      { label: 'New Message', accelerator: 'CmdOrCtrl+N', click: () => go('/social/messages') },
      { label: 'New Event', accelerator: 'CmdOrCtrl+Shift+N', click: () => go('/calendar') },
      { type: 'separator' },
      { label: 'Open Portal in Browser', click: () => shell.openExternal(PORTAL_URL) },
      { type: 'separator' },
      { label: 'Sign Out of This Device', click: signOutOfThisDevice },
      { type: 'separator' },
      ...(IS_MAC ? [{ role: 'close' }] : [
        {
          label: 'Portal Settings',
          accelerator: 'CmdOrCtrl+,',
          click: () => go('/account-settings'),
        },
        appSettingsMenu(),
        { type: 'separator' },
        { role: 'close' },
        // Quit, not close: on Windows closing the window backgrounds the app,
        // so this is the only menu item that actually ends it.
        { label: 'Exit', accelerator: 'Alt+F4', click: () => app.quit() },
      ]),
    ],
  };

  const template = [
    ...(IS_MAC ? [macAppMenu] : []),
    fileMenu,
    { role: 'editMenu' },
    {
      label: 'Go',
      submenu: [
        ...PLACES.map((place, index) => ({
          label: place.label,
          accelerator: `CmdOrCtrl+${index + 1}`,
          click: () => go(place.path),
        })),
        { type: 'separator' },
        {
          label: 'Back',
          accelerator: 'CmdOrCtrl+[',
          enabled: !!(history() && history().canGoBack()),
          click: () => history() && history().goBack(),
        },
        {
          label: 'Forward',
          accelerator: 'CmdOrCtrl+]',
          enabled: !!(history() && history().canGoForward()),
          click: () => history() && history().goForward(),
        },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { role: 'toggleDevTools' },
      ],
    },
    {
      role: 'windowMenu',
      submenu: [
        { role: 'minimize' },
        // 'zoom' and 'front' are macOS-only roles; on Windows they render as
        // dead entries, so the menu is just Minimise and Show there.
        ...(IS_MAC ? [{ role: 'zoom' }] : []),
        {
          label: 'Show Portal',
          accelerator: 'CmdOrCtrl+Shift+H',
          click: () => revealWindow({ steal: true }),
        },
        ...(IS_MAC ? [{ type: 'separator' }, { role: 'front' }] : []),
      ],
    },
    {
      role: 'help',
      submenu: [
        // Also here: the app menu is the convention, but Help is where people
        // actually go looking for it.
        checkForUpdatesItem(),
        { type: 'separator' },
        { label: 'Open Portal in Browser', click: () => shell.openExternal(PORTAL_URL) },
        {
          // Notifications fail at three different layers, macOS, the app, and
          // the portal's own per-account switch, and they are indistinguishable
          // from "nothing happened". This answers the first of the three.
          label: 'Send a Test Notification',
          click: () => {
            if (!notifications.test(() => revealWindow({ steal: true }))) {
              dialog.showMessageBox(mainWindow, {
                type: 'warning',
                message: 'This system cannot show notifications',
                detail: 'Nothing further to try here, the operating system is refusing them outright.',
              });
            }
          },
        },
        { type: 'separator' },
        {
          label: 'Report a Problem…',
          click: () => shell.openExternal(
            `mailto:support@tmantoine.com?subject=${encodeURIComponent(`Portal desktop ${APP_VERSION}`)}`,
          ),
        },
        // macOS puts About in the app menu; Windows has no app menu, and Help
        // is where it belongs there.
        ...(IS_MAC ? [] : [
          { type: 'separator' },
          {
            label: 'About TM ANTOINE Portal',
            click: () => dialog.showMessageBox(mainWindow, {
              type: 'info',
              message: 'TM ANTOINE Portal',
              detail: `Version ${APP_VERSION}\n${PORTAL_URL}`,
              buttons: ['OK'],
            }),
          },
        ]),
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* ---------------------------------------------------------------------- lifecycle */

app.setName('TM ANTOINE Portal');

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // The browser hands the session back through this scheme, so a second launch
  // is usually a sign-in completing, not someone opening the app twice.
  app.on('second-instance', (_event, argv) => {
    const deepLink = argv.find((arg) => arg.startsWith(`${PROTOCOL}://`));
    if (deepLink) claimBrowserSession(deepLink);
    revealWindow({ steal: true });
  });

  // macOS delivers the deep link as an event. Windows re-launches the exe with
  // the URL as an argument instead, which `second-instance` covers for a
  // running app, but not for a cold start, where it arrives in our own argv.
  app.on('open-url', (event, url) => {
    event.preventDefault();
    if (url.startsWith(`${PROTOCOL}://`)) claimBrowserSession(url);
  });

  const argvDeepLink = () => process.argv.find((arg) => arg.startsWith(`${PROTOCOL}://`));

  app.whenReady().then(async () => {
    if (app.isPackaged) {
      app.setAsDefaultProtocolClient(PROTOCOL);
    } else {
      // An unpackaged run is `electron .`, so the OS needs both the binary and
      // the app directory to hand the URL back to the right place.
      app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(__dirname)]);
    }

    session.defaultSession.setUserAgent(chromeUserAgent());

    /*
     * About this app, with the firm's mark on it.
     *
     * The Mac menu carries `role: 'about'`, and with nothing configured that
     * opens a panel showing a generic icon and the word "Electron" under the
     * version. It is a small window almost nobody opens, and it is also the
     * one place in the app that answers "what is this program", a stock icon
     * there says the answer is "somebody else's".
     */
    app.setAboutPanelOptions({
      applicationName: 'TM ANTOINE Portal',
      applicationVersion: APP_VERSION,
      // Both, deliberately: macOS prints `version` in smaller type beneath the
      // application version, and left unset it falls back to Electron's own.
      version: APP_VERSION,
      copyright: `© ${new Date().getFullYear()} TM ANTOINE Advisory`,
      iconPath: path.join(__dirname, 'assets', 'icon-master.png'),
    });

    // Packaged builds get icon.icns; an unpackaged run would otherwise show
    // the stock Electron dock icon.
    if (IS_MAC && !app.isPackaged) {
      const logo = nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon-master.png'));
      if (!logo.isEmpty()) app.dock.setIcon(logo);
    }

    // Groups the window under one taskbar button and lets Windows match the
    // running app to its Start-menu shortcut, without it, notifications are
    // attributed to "electron.app.…" instead of the portal.
    if (process.platform === 'win32') app.setAppUserModelId('com.tmantoinelaw.portal');

    applyPermissionPolicy();
    settings.apply();

    const fromMainWindow = (event) => mainWindow && event.sender === mainWindow.webContents;

    ipcMain.on('tma:badge', (event, count) => fromMainWindow(event) && applyBadge(count));
    ipcMain.on('tma:call', (event, phase) => fromMainWindow(event) && applyCallPhase(phase));
    ipcMain.on('tma:focus', (event) => fromMainWindow(event) && revealWindow({ steal: true }));
    ipcMain.on('tma:signin-reopen', (event) => {
      if (!fromMainWindow(event) || !pendingBrowserSignInUrl) return;
      shell.openExternal(pendingBrowserSignInUrl);
    });
    ipcMain.on('tma:signin-cancel', (event) => {
      if (!fromMainWindow(event)) return;
      forgetVerifier();
      if (mainWindow && !mainWindow.isDestroyed()) {
        loadPortal(mainWindow, new URL('/auth/login', PORTAL_ORIGIN).toString());
      }
    });

    // From the ring panel. It has no portal session of its own, so answering
    // and declining both go through the page that owns the call.
    ipcMain.on('call:accept', answerCall);
    ipcMain.on('call:decline', declineCall);

    /*
     * Before the window, and deliberately NOT awaited. The handler is live
     * the moment install() returns; what the promise carries is verification
     * against the deploy, which is a network round trip, and a cold start
     * that waits on the network is the thing this whole layer exists to end.
     * Asset requests hold for verification inside the handler; the window,
     * and the cached shell it paints, do not.
     */
    const verifying = assetCache.install(PORTAL_ORIGIN);
    verifying.then((assets) => {
      console.log(assets.active
        ? `  • assets: ${assets.count}/${assets.total} served from the app (${assets.mode})`
          + (assets.stale ? `, ${assets.stale} from the portal (changed since this build)` : '')
        : `  • assets: using the network (${assets.reason})`);
    });

    /*
     * When a shell served from disk turns out to be the wrong one, the
     * portal deployed, the session died, somebody else signed in, the only
     * honest move is a fresh copy from the network. IgnoringCache, because
     * the wrong shell may have primed the HTTP cache with the wrong assets.
     */
    // Document bytes, kept per machine under a budget, see file-cache.js.
    fileCache.configure({ dir: path.join(app.getPath('userData'), 'file-cache') });

    /*
     * The portal deploys while the app is open, and the app is open for days.
     * install()'s verification cannot see that, so ask again: on a timer, and
     * whenever the window comes back to the front — which is the beat before
     * somebody starts using it again, and so the cheapest place to find out.
     * (Every navigation asks too; see asset-cache's revalidate.)
     */
    setInterval(() => { assetCache.revalidate(); }, 10 * 60 * 1000).unref();
    app.on('browser-window-focus', () => { assetCache.revalidate(); });

    shellCache.on({
      stale: (reason) => {
        console.log(`  • shell cache: reloading (${reason})`);
        /*
         * The kept document bytes go with the shell, for the two reasons a
         * shell goes stale that are about WHO: a dead session, and somebody
         * else signing in. Their right to every cached document is their own,
         * not inherited from whoever fetched it. A deploy changing is about
         * WHAT and keeps the bytes, files do not redeploy with the portal.
         */
        if (reason === 'signed-out' || reason === 'account-changed') fileCache.clear();
        if (mainWindow) mainWindow.webContents.reloadIgnoringCache();
      },
    });

    createWindow();
    buildMenu();

    // A fresh install has never asked macOS for permission, so the app is not
    // even listed in System Settings → Notifications. Posting one now puts the
    // prompt in front of someone who is looking at the app they just installed.
    notifications.primeOnFirstRun(() => revealWindow({ steal: true }));

    // And on Windows, where the app it was just installed from is sitting on
    // the taskbar unpinned and will vanish from it the moment it is closed.
    taskbarPin.promptOnFirstRun({ parent: mainWindow });

    // Off macOS this is the only thing left on screen once the window is
    // closed, so it carries Show and Quit. Rebuilt alongside the menu bar so
    // "Install Update x.y.z" appears in both.
    const trayMenu = tray.install({
      onShow: () => revealWindow({ steal: true }),
      onQuit: () => app.quit(),
      updateItem: checkForUpdatesItem,
    });

    const rebuildMenus = () => {
      buildMenu();
      if (trayMenu) trayMenu.rebuild();
      // The menus only say so while they are open. On Windows both of them are
      // behind a click, so the waiting update also goes on the tray tooltip,
      // which is the one place a glance can reach it.
      tray.setUpdateWaiting(updater.deferredUpdate());
    };

    // Relabel the menus when an update is found and deferred.
    updater.onStateChange(rebuildMenus);
    updater.start();

    // A cold start from a tmaportal:// link on Windows: the URL is in our argv
    // rather than an open-url event, and only means anything once the window
    // exists to load the claim into.
    const cold = argvDeepLink();
    if (cold) claimBrowserSession(cold);

    // Clicking the dock icon brings back the window we hid on close.
    app.on('activate', () => {
      if (!mainWindow) return createWindow();
      revealWindow({ steal: true });
    });
  });

  // Quit is the only thing that ends the app; closing the window backgrounds
  // it so messages and calls keep arriving.
  app.on('before-quit', () => { quitting = true; });

  // The usual "quit when the last window closes off macOS" would defeat the
  // whole point here: with backgroundOnClose on, the window is hidden rather
  // than destroyed, and the app is meant to keep taking messages and calls
  // from the tray. Quitting is left to Exit, the tray, or Alt+F4 twice over.
  app.on('window-all-closed', () => {
    if (!IS_MAC && !settings.get('backgroundOnClose')) app.quit();
  });
}
