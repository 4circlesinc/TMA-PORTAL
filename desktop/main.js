const {
  app, BrowserWindow, Menu, shell, session, dialog, nativeImage,
  ipcMain, systemPreferences, powerSaveBlocker,
} = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

const HOST_BRIDGE = require('./host-bridge');
const updater = require('./updater');
const { installCloseToBackground } = require('./window-policy');
const callWindow = require('./call-window');
const titlebar = require('./titlebar');
const tray = require('./tray');
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
    // first run, or the file got mangled — fall through to defaults
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

// Closing the window puts the app in the background rather than ending it, so
// messages and calls keep arriving. Only Quit — or an update restart — sets
// this, and only then is the window really allowed to go.
let quitting = false;

function createWindow() {
  const state = readWindowState();

  mainWindow = new BrowserWindow({
    ...state,
    minWidth: 960,
    minHeight: 640,
    show: false,
    // Painted before the first frame arrives, so the window opens brand blue
    // rather than flashing white on its way to the portal.
    backgroundColor: titlebar.BLUE,
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

  installCloseToBackground(
    mainWindow,
    () => quitting || !settings.get('backgroundOnClose'),
    () => saveWindowState(mainWindow),
  );

  mainWindow.on('closed', () => { mainWindow = null; });

  attachNavigationRules(mainWindow);
  loadPortal(mainWindow);
}

function loadPortal(win, url = PORTAL_URL) {
  win.loadURL(url, { userAgent: chromeUserAgent() }).catch(() => {
    // handled by did-fail-load
  });
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

  webContents.setWindowOpenHandler(({ url }) => {
    const provider = signInProviderFor(url, webContents.getURL());
    if (provider) {
      startBrowserSignIn(provider);
      return { action: 'deny' };
    }

    // Connecting a mailbox from Settings: the session is already ours, so keep
    // it in-app in a child window that shares our cookies.
    if (isAuthUrl(url) || isSocialRedirect(url)) {
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
    const provider = signInProviderFor(url, webContents.getURL());
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

  webContents.on('did-finish-load', () => {
    // Before the portal check: the error page below is ours too, and it would
    // otherwise render underneath the bar.
    titlebar.apply(webContents);

    if (!isPortalUrl(webContents.getURL())) {
      applyBadge(0);
      applyCallPhase('');
      return;
    }
    webContents.executeJavaScript(HOST_BRIDGE, true).catch(() => {
      // A page that never exposed the stores just leaves the badge alone.
    });
  });

  // The portal routes through pushState, which fires no load event. Without
  // this the bar survives the first screen and disappears on the second.
  webContents.on('did-navigate-in-page', () => titlebar.apply(webContents));

  webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) return; // -3 = user aborted
    showLoadError(win, errorDescription, validatedURL);
  });

  /*
   * A 5xx is a *successful* load as far as Chromium is concerned — bytes were
   * asked for and bytes arrived — so did-fail-load never sees it and the body
   * renders as the page. When the portal is between containers that body is the
   * proxy's own, and the window fills with "upstream connect error or
   * disconnect/reset before headers… connection refused", which reads like the
   * app is broken rather than the server being briefly away.
   */
  webContents.on('did-navigate', (_event, url, httpResponseCode, httpStatusText) => {
    if (httpResponseCode < 500) return;

    showLoadError(
      win,
      'The portal is temporarily unavailable — it may be restarting. '
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
 * the machine can claim that scheme, so the reply carries only a token — worth
 * nothing without the verifier, which never leaves here. The server half is
 * app/Http/Controllers/DesktopAuthController.php.
 */

const SOCIAL_REDIRECT = /^\/auth\/social\/(google|microsoft)\/redirect\b/;

const base64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

let pendingVerifier = null;

function isSocialRedirect(url) {
  try {
    const parsed = new URL(url);
    return parsed.origin === PORTAL_ORIGIN && SOCIAL_REDIRECT.test(parsed.pathname);
  } catch {
    return false;
  }
}

/*
 * Returns the provider only when this is someone *signing in* — that is, the
 * click came from a page under /auth/. The same route is used to connect a
 * mailbox from Settings, and that one must stay in the app's own session.
 */
function signInProviderFor(url, currentUrl) {
  if (!isSocialRedirect(url)) return null;

  try {
    const from = new URL(currentUrl || '');
    const signingIn = from.origin === PORTAL_ORIGIN
      && from.pathname.startsWith('/auth/')
      && !from.pathname.startsWith('/auth/desktop');
    if (!signingIn) return null;
  } catch {
    return null;
  }

  return new URL(url).pathname.match(SOCIAL_REDIRECT)[1];
}

function startBrowserSignIn(provider) {
  const verifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
  pendingVerifier = verifier;

  const url = new URL('/auth/desktop/start', PORTAL_ORIGIN);
  url.searchParams.set('challenge', challenge);
  if (provider) url.searchParams.set('provider', provider);

  shell.openExternal(url.toString());
}

function claimBrowserSession(deepLink) {
  let token = null;
  try {
    token = new URL(deepLink).searchParams.get('token');
  } catch {
    return;
  }

  if (!token || !pendingVerifier || !mainWindow) return;

  const url = new URL('/auth/desktop/claim', PORTAL_ORIGIN);
  url.searchParams.set('token', token);
  url.searchParams.set('verifier', pendingVerifier);
  pendingVerifier = null;

  revealWindow({ steal: true });
  loadPortal(mainWindow, url.toString());
}

/* ----------------------------------------------------------------- unread badge */

/**
 * Windows has no dock badge. `app.setBadgeCount` is macOS and Linux only and
 * returns false here without doing anything, so the count is drawn as a
 * taskbar overlay icon instead — the same convention Mail and Teams use.
 */
function taskbarOverlay(count) {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  if (count <= 0) {
    mainWindow.setOverlayIcon(null, '');
    return;
  }

  const label = count > 99 ? '99+' : String(count);
  const size = 32;
  const font = label.length > 2 ? 13 : 18;

  // An SVG data URL keeps this to one file with no extra image assets, and
  // scales cleanly to whatever the taskbar asks for.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <circle cx="16" cy="16" r="15" fill="#d21c1c"/>
    <text x="16" y="16" fill="#fff" font-family="Segoe UI, sans-serif" font-size="${font}"
      font-weight="600" text-anchor="middle" dominant-baseline="central">${label}</text>
  </svg>`;

  const image = nativeImage.createFromDataURL(
    `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`,
  );

  mainWindow.setOverlayIcon(image, `${label} unread`);
}

function applyBadge(count) {
  const n = Number.isFinite(count) && count > 0 ? Math.min(Math.round(count), 999) : 0;

  if (IS_MAC) {
    app.setBadgeCount(n);
    return;
  }

  taskbarOverlay(n);
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

/** Who is calling, straight from the page — see publishCallPhase(). */
async function readCallInfo() {
  const fallback = { name: 'Incoming call', avatar: '', media: 'audio' };
  if (!mainWindow) return fallback;

  try {
    const raw = await mainWindow.webContents.executeJavaScript(
      "document.documentElement.getAttribute('data-tma-call-info')", true,
    );
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
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
  mainWindow.webContents.executeJavaScript('window.TMAMessagingCalls.accept(true)', true).catch(() => {});
  // Answering is the one moment the app should come forward.
  revealWindow({ steal: true });
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
      // 'critical' bounces until the app is activated — the whole point of a
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
 * for itself — the web permission grant alone leaves getUserMedia failing with
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
  { label: 'Projects', path: '/projects/all' },
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
  // `role: 'appMenu'` and everything under it — services, hide, hideOthers,
  // unhide — exist only on macOS. Windows convention puts About and Quit at
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
  // running app — but not for a cold start, where it arrives in our own argv.
  app.on('open-url', (event, url) => {
    event.preventDefault();
    if (url.startsWith(`${PROTOCOL}://`)) claimBrowserSession(url);
  });

  const argvDeepLink = () => process.argv.find((arg) => arg.startsWith(`${PROTOCOL}://`));

  app.whenReady().then(() => {
    if (app.isPackaged) {
      app.setAsDefaultProtocolClient(PROTOCOL);
    } else {
      // An unpackaged run is `electron .`, so the OS needs both the binary and
      // the app directory to hand the URL back to the right place.
      app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(__dirname)]);
    }

    session.defaultSession.setUserAgent(chromeUserAgent());

    // Packaged builds get icon.icns; an unpackaged run would otherwise show
    // the stock Electron dock icon.
    if (IS_MAC && !app.isPackaged) {
      const logo = nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon-master.png'));
      if (!logo.isEmpty()) app.dock.setIcon(logo);
    }

    // Groups the window under one taskbar button and lets Windows match the
    // running app to its Start-menu shortcut — without it, notifications are
    // attributed to "electron.app.…" instead of the portal.
    if (process.platform === 'win32') app.setAppUserModelId('com.tmantoinelaw.portal');

    applyPermissionPolicy();
    settings.apply();

    const fromMainWindow = (event) => mainWindow && event.sender === mainWindow.webContents;

    ipcMain.on('tma:badge', (event, count) => fromMainWindow(event) && applyBadge(count));
    ipcMain.on('tma:call', (event, phase) => fromMainWindow(event) && applyCallPhase(phase));
    ipcMain.on('tma:focus', (event) => fromMainWindow(event) && revealWindow({ steal: true }));

    // From the ring panel. It has no portal session of its own, so answering
    // and declining both go through the page that owns the call.
    ipcMain.on('call:accept', answerCall);
    ipcMain.on('call:decline', declineCall);

    createWindow();
    buildMenu();

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
