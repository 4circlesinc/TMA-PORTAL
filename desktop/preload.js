const { contextBridge, ipcRenderer } = require('electron');

// Nothing from Node is exposed to the portal. This flag exists so page code
// can tell it is running inside the desktop shell (e.g. to hide "install the
// app" prompts or browser-only affordances) without gaining any privileges.
contextBridge.exposeInMainWorld('TMADesktop', {
  isDesktop: true,
  platform: process.platform,
  version: process.versions.electron,
});

/*
 * Relay for everything the page publishes onto <html>. See host-bridge.js for
 * the badge and focus writers, and messaging-calls.js for data-tma-call.
 *
 *   data-tma-badge  "7"                  unread notifications + new activity
 *   data-tma-call   "ringing" | "active" call phase, drives dock + sleep
 *   data-tma-focus  "<timestamp>"        page asked for the app to come forward
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
