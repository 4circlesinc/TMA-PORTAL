const {
  app, BrowserWindow, Menu, shell, session, dialog, nativeImage,
  ipcMain, systemPreferences, powerSaveBlocker,
} = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

const HOST_BRIDGE = require('./host-bridge');

// Which portal this shell talks to. Override for local work:
//   TMA_PORTAL_URL=http://localhost:8001 npm start
const PORTAL_URL = process.env.TMA_PORTAL_URL || 'https://portal.tmantoinelaw.com';
const PORTAL_ORIGIN = new URL(PORTAL_URL).origin;

const PROTOCOL = 'tmaportal';

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

function createWindow() {
  const state = readWindowState();

  mainWindow = new BrowserWindow({
    ...state,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: '#ffffff',
    title: 'TM ANTOINE Portal',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('close', () => saveWindowState(mainWindow));
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
    app.focus({ steal: true });
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
    if (!isPortalUrl(webContents.getURL())) {
      applyBadge(0);
      applyCallPhase('');
      return;
    }
    webContents.executeJavaScript(HOST_BRIDGE, true).catch(() => {
      // A page that never exposed the stores just leaves the badge alone.
    });
  });

  webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) return; // -3 = user aborted
    showLoadError(win, errorDescription, validatedURL);
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
      body { font: 15px/1.5 -apple-system, system-ui, sans-serif; color: #1c1c1c;
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

/* ------------------------------------------------------------------ dock badge */

function applyBadge(count) {
  const n = Number.isFinite(count) && count > 0 ? Math.min(Math.round(count), 999) : 0;
  app.setBadgeCount(n);
}

/* ----------------------------------------------------------------------- calling
 *
 * messaging-calls.js publishes the phase; the shell supplies what a web page
 * cannot: a dock that keeps bouncing until the call is dealt with, and a
 * display that does not sleep mid-call.
 */

let bounceId = null;
let powerBlockerId = null;

function applyCallPhase(phase) {
  if (phase === 'ringing') {
    revealWindow({ steal: false });
    if (process.platform === 'darwin' && bounceId == null) {
      // 'critical' bounces until the app is activated — the whole point of a
      // ring you can hear from another Space.
      bounceId = app.dock.bounce('critical');
    }
  } else if (bounceId != null) {
    if (process.platform === 'darwin') app.dock.cancelBounce(bounceId);
    bounceId = null;
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
  if (process.platform !== 'darwin') return true;

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

/* ------------------------------------------------------------------ auto-update */

let updateReady = false;

function setupAutoUpdate() {
  // electron-updater needs a packaged, signed app; in dev there is nothing to
  // replace and it throws on the missing app-update.yml.
  if (!app.isPackaged) return;

  const { autoUpdater } = require('electron-updater');

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-downloaded', async ({ version }) => {
    updateReady = true;

    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      buttons: ['Later', 'Restart Now'],
      defaultId: 1,
      cancelId: 0,
      message: `Version ${version} is ready`,
      detail: 'Restart to finish updating. It will also install on its own the next time you quit.',
    });

    if (response === 1) autoUpdater.quitAndInstall();
  });

  autoUpdater.on('error', () => {
    // A failed check is not worth interrupting anyone over; the next one runs
    // within the hour, and the app still works.
  });

  const check = () => autoUpdater.checkForUpdates().catch(() => {});

  setTimeout(check, 10000);        // shortly after launch
  setInterval(check, 3600000);     // and hourly, so a deploy lands the same day
  app.on('browser-window-focus', check);

  return autoUpdater;
}

/* ------------------------------------------------------------------------- menu */

function buildMenu(autoUpdater) {
  const template = [
    {
      role: 'appMenu',
      submenu: [
        { role: 'about' },
        {
          label: 'Check for Updates…',
          enabled: app.isPackaged,
          click: async () => {
            if (!autoUpdater) return;
            if (updateReady) return autoUpdater.quitAndInstall();

            const result = await autoUpdater.checkForUpdates().catch(() => null);
            const latest = result && result.updateInfo && result.updateInfo.version;

            if (!latest || latest === app.getVersion()) {
              dialog.showMessageBox(mainWindow, {
                type: 'info',
                message: "You're up to date",
                detail: `Version ${app.getVersion()}.`,
              });
            }
          },
        },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    { role: 'fileMenu' },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        {
          label: 'Portal Home',
          accelerator: 'CmdOrCtrl+Shift+H',
          click: () => mainWindow && loadPortal(mainWindow),
        },
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
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        {
          label: 'Open Portal in Browser',
          click: () => shell.openExternal(PORTAL_URL),
        },
        {
          label: 'Sign Out of This Device',
          click: async () => {
            const { response } = await dialog.showMessageBox(mainWindow, {
              type: 'question',
              buttons: ['Cancel', 'Clear Session'],
              defaultId: 1,
              cancelId: 0,
              message: 'Clear the saved session on this Mac?',
              detail: 'You will be asked to sign in again the next time you open the app.',
            });
            if (response !== 1) return;
            await session.defaultSession.clearStorageData({ storages: ['cookies', 'localstorage'] });
            loadPortal(mainWindow);
          },
        },
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

  app.on('open-url', (event, url) => {
    event.preventDefault();
    if (url.startsWith(`${PROTOCOL}://`)) claimBrowserSession(url);
  });

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
    if (process.platform === 'darwin' && !app.isPackaged) {
      const logo = nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon-master.png'));
      if (!logo.isEmpty()) app.dock.setIcon(logo);
    }

    applyPermissionPolicy();

    const fromMainWindow = (event) => mainWindow && event.sender === mainWindow.webContents;

    ipcMain.on('tma:badge', (event, count) => fromMainWindow(event) && applyBadge(count));
    ipcMain.on('tma:call', (event, phase) => fromMainWindow(event) && applyCallPhase(phase));
    ipcMain.on('tma:focus', (event) => fromMainWindow(event) && revealWindow({ steal: true }));

    createWindow();
    buildMenu(setupAutoUpdate());

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
