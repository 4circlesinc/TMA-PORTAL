const { contextBridge, ipcRenderer } = require('electron');

// Almost nothing from Node is exposed to the portal. isDesktop exists so
// page code can tell it is running inside the desktop shell (e.g. to hide
// "install the app" prompts) without gaining privileges. openInBrowser is
// a clicked email link leaving the app (main still validates the URL).
// openLocationSettings opens the OS Location pane after a deny.
// Handlers for banners posted through TMADesktop.notify, by id: a click opens
// what it was about, a reply (macOS) is sent by the page.
const notificationHandlers = new Map();
let notificationSeq = 0;
function notificationEvent(kind) {
  return (_event, id, payload) => {
    const handlers = notificationHandlers.get(id);
    notificationHandlers.delete(id);
    const fn = handlers && handlers[kind];
    if (typeof fn === 'function') {
      try { fn(payload); } catch { /* the page's handler threw */ }
    }
  };
}
ipcRenderer.on('tma:notification-click', notificationEvent('onClick'));
ipcRenderer.on('tma:notification-reply', notificationEvent('onReply'));

contextBridge.exposeInMainWorld('TMADesktop', {
  isDesktop: true,
  platform: process.platform,
  version: process.versions.electron,
  // 'mac-app-store' in the store build, which must not offer downloads of
  // other builds. null for the direct download.
  store: process.mas ? 'mac-app-store' : null,
  openInBrowser: (url) => {
    if (typeof url !== 'string') return;
    ipcRenderer.invoke('tma:open-in-browser', url);
  },
  openLocationSettings: () => ipcRenderer.invoke('tma:open-location-settings'),
  // Sign as admin, and the way back. Called from current-user.js before
  // the navigation. The shell on disk belongs to whoever was signed in
  // when it was captured; drop it so the next document is the new account.
  dropShell: () => ipcRenderer.invoke('tma:drop-shell'),
  // The portal's banner, posted by the app: who, the group or subject, the
  // message, the photo (a data: URL), and on a Mac a Reply box. handlers:
  // { onClick, onReply(text) }.
  notify: (options, handlers) => {
    const id = ++notificationSeq;
    if (handlers && typeof handlers === 'object') {
      notificationHandlers.set(id, { onClick: handlers.onClick, onReply: handlers.onReply });
    }
    const o = options || {};
    return ipcRenderer.invoke('tma:notify', {
      title: String(o.title || ''),
      subtitle: String(o.subtitle || ''),
      body: String(o.body || ''),
      icon: typeof o.icon === 'string' && o.icon.startsWith('data:image/') && o.icon.length < 3000000 ? o.icon : '',
      silent: !!o.silent,
      reply: !!o.reply,
      replyPlaceholder: String(o.replyPlaceholder || ''),
    }, id);
  },
});

/*
 * Relay for everything the page publishes onto <html>. See host-bridge.js for
 * the badge and focus writers, and messaging-calls.js for data-tma-call.
 *
 *   data-tma-badge   "7"                  unread notifications + new activity
 *   data-tma-call    "ringing" | "active" call phase, drives dock + sleep
 *   data-tma-focus   "<timestamp>"        page asked for the app to come forward
 *   data-tma-overlay "1"                  a full-screen viewer or signature wizard is covering the page
 */
const RELAYS = [
  {
    attribute: 'data-tma-badge',
    channel: 'tma:badge',
    read: (raw) => {
      const n = raw == null ? 0 : Number.parseInt(raw, 10);
      return Number.isFinite(n) ? n : 0;
    },
  },
  { attribute: 'data-tma-call', channel: 'tma:call', read: (raw) => raw || '' },
  // A full-screen file viewer or signature wizard is open. macOS draws its
  // traffic lights above the page, so the shell takes them off screen while one is up.
  { attribute: 'data-tma-overlay', channel: 'tma:overlay', read: (raw) => raw === '1' },
  // The portal's theme (dashboard.js stamps <html>). Windows paints its own
  // caption buttons in titleBarOverlay.color, which only the main process can
  // change, so the strip needs telling when the bar under it goes dark blue.
  { attribute: 'data-theme', channel: 'tma:theme', read: (raw) => raw === 'dark' },
  { attribute: 'data-tma-focus', channel: 'tma:focus', read: () => true, skipInitial: true },
  // Sign-in waiting screen (file://) — reopen the system-browser tab, or cancel.
  { attribute: 'data-tma-signin-reopen', channel: 'tma:signin-reopen', read: () => true, skipInitial: true },
  { attribute: 'data-tma-signin-cancel', channel: 'tma:signin-cancel', read: () => true, skipInitial: true },
];

function watchHostAttributes() {
  const el = document.documentElement;
  if (!el) return;

  for (const relay of RELAYS) {
    const send = () => ipcRenderer.send(relay.channel, relay.read(el.getAttribute(relay.attribute)));

    new MutationObserver(send).observe(el, {
      attributes: true,
      attributeFilter: [relay.attribute],
    });

    // Focus is an event, not a state: replaying it on load would yank the app
    // forward every navigation.
    if (!relay.skipInitial) send();
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', watchHostAttributes, { once: true });
} else {
  watchHostAttributes();
}
