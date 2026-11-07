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
const { Notification } = require('electron');

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

/*
 * The portal's banners, posted here rather than as browser notifications so
 * they can play the alert sound chosen in Settings → Notifications. macOS
 * plays its own alert sounds by name (/System/Library/Sounds), so nothing is
 * shipped; elsewhere the OS plays its default. The list matches
 * App\Support\Notifications\NotificationSounds::MAC on the server, and a name
 * not on it is the default, never a path.
 */
const SOUNDS = ['Basso', 'Blow', 'Bottle', 'Frog', 'Funk', 'Glass', 'Hero', 'Morse', 'Ping', 'Pop', 'Purr', 'Sosumi', 'Submarine', 'Tink'];

/** Notification options for a sound choice: a name, 'default' or 'none'. */
function soundOptions(choice) {
  if (choice === 'none') return { silent: true };
  if (process.platform === 'darwin' && SOUNDS.includes(choice)) return { silent: false, sound: choice };
  return { silent: false };
}

// Held until clicked or closed: a notification collected before then would
// take its click handler with it.
const shown = new Set();

/**
 * @param {{ title?: string, body?: string, sound?: string }} options
 * @param {() => void} [onClick]
 */
function show(options, onClick) {
  if (!Notification.isSupported()) return false;
  const opts = options || {};
  try {
    const note = new Notification({
      title: String(opts.title || 'TM ANTOINE Portal').slice(0, 200),
      body: String(opts.body || '').slice(0, 1000),
      ...soundOptions(opts.sound),
    });
    shown.add(note);
    note.on('click', () => {
      shown.delete(note);
      if (typeof onClick === 'function') onClick();
    });
    note.on('close', () => shown.delete(note));
    note.show();
    return true;
  } catch {
    return false;
  }
}

/** Settings → Notifications: a sample banner in the chosen sound. */
function preview(sound, onClick) {
  return show({
    title: 'Notification sound',
    body: sound === 'none' ? 'Notifications will be silent.' : 'This is how portal notifications will sound.',
    sound,
  }, onClick);
}

/** True once the app has asked the OS at least once. */
const primed = () => !!settings.get('notificationsPrimed');

module.exports = { primeOnFirstRun, test, primed, show, preview, soundOptions, SOUNDS, isSupported: () => Notification.isSupported() };
