'use strict';

/*
 * First-run notification priming.
 *
 * A fresh install is silent in a way that looks broken: macOS only asks
 * "TM ANTOINE Portal would like to send you notifications" the first time the
 * app actually posts one, and until then the app is not even listed in System
 * Settings → Notifications. Someone who installs the app, goes looking for that
 * switch and finds nothing has no way to turn on the thing they want.
 *
 * So the app posts one itself, once, on first run: the OS prompt appears while
 * the person is looking at the app they just installed, and the app is
 * registered from then on either way.
 *
 * This covers the *operating system's* permission only. The portal has its own
 * per-account "Desktop notifications" switch, which is what decides whether a
 * banner is ever raised, see notify-store.js. Both have to be on, and they are
 * genuinely different questions: one is "may this app notify you at all", the
 * other is "do you want to be told about this account's messages".
 */
const { Notification, nativeImage } = require('electron');

const settings = require('./settings');

/**
 * @param {() => void} onClick Bring the app forward, as any banner should.
 */
function primeOnFirstRun(onClick) {
  if (settings.get('notificationsPrimed')) return;

  // Marked before showing rather than after: if posting throws on some future
  // macOS, the alternative is asking again on every single launch.
  settings.set('notificationsPrimed', true);

  if (!Notification.isSupported()) return;

  try {
    const note = new Notification({
      title: 'Notifications are on',
      body: `You'll be told here about messages, email and calendar changes.`,
      silent: false,
    });

    if (typeof onClick === 'function') note.on('click', onClick);
    note.show();
  } catch {
    // A refused notification is not a reason to fail a launch.
  }
}

/**
 * Posts a notification on demand, used by the Help menu, so someone who thinks
 * notifications are broken can find out in one click whether the problem is the
 * OS, the app, or the portal's own switch.
 */
function test(onClick) {
  if (!Notification.isSupported()) return false;

  try {
    const note = new Notification({
      title: 'TM ANTOINE Portal',
      body: 'This is a test notification. If you can see it, macOS is letting the app through.',
      silent: false,
    });

    if (typeof onClick === 'function') note.on('click', onClick);
    note.show();
    return true;
  } catch {
    return false;
  }
}

// Held until clicked, replied to or closed: a notification collected before
// then would take its handlers with it.
const shown = new Set();

/**
 * The portal's banner for a message, an email or anything else (posted by the
 * page's notify-store.js through preload.js notify), laid out the way the
 * page describes it: who as the title, then the group or the email's subject,
 * then the message, with the photo beside it.
 *
 * macOS has a line for the group or subject (subtitle) and takes a reply in
 * the banner itself (hasReply). Windows has neither for an app like this
 * one, so the group or subject leads the body and the banner opens the
 * conversation, where the reply is typed.
 *
 * @param {{ title?: string, subtitle?: string, body?: string, icon?: string,
 *           silent?: boolean, reply?: boolean, replyPlaceholder?: string }} options
 * @param {{ onClick?: () => void, onReply?: (text: string) => void }} [handlers]
 */
function show(options, handlers) {
  if (!Notification.isSupported()) return false;
  const o = options || {};
  const on = handlers || {};
  const mac = process.platform === 'darwin';
  const subtitle = String(o.subtitle || '').slice(0, 200);
  const text = String(o.body || '').slice(0, 1000);

  let icon;
  if (typeof o.icon === 'string' && o.icon.startsWith('data:image/')) {
    try {
      const image = nativeImage.createFromDataURL(o.icon);
      if (!image.isEmpty()) icon = image;
    } catch {
      // A picture that will not decode: the banner goes without it.
    }
  }

  try {
    const note = new Notification({
      title: String(o.title || 'TM ANTOINE Portal').slice(0, 200),
      ...(mac ? { subtitle, body: text } : { body: [subtitle, text].filter(Boolean).join('\n') }),
      ...(icon ? { icon } : {}),
      silent: !!o.silent,
      ...(mac && o.reply ? { hasReply: true, replyPlaceholder: String(o.replyPlaceholder || 'Reply').slice(0, 60) } : {}),
    });
    shown.add(note);
    note.on('click', () => {
      shown.delete(note);
      if (typeof on.onClick === 'function') on.onClick();
    });
    note.on('reply', (_event, reply) => {
      shown.delete(note);
      if (typeof on.onReply === 'function') on.onReply(String(reply || ''));
    });
    note.on('close', () => shown.delete(note));
    note.show();
    return true;
  } catch {
    return false;
  }
}

/** True once the app has asked the OS at least once. */
const primed = () => !!settings.get('notificationsPrimed');

module.exports = { primeOnFirstRun, test, primed, show, isSupported: () => Notification.isSupported() };
