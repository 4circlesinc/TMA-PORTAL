/*
 * Preferences that belong to the app rather than the account.
 *
 * Everything the portal knows about a person already syncs server-side through
 * /me/preferences. These three are different: they are about this machine —
 * whether the app launches with it, whether closing the window leaves it
 * running, and whether a call rings in its own window. They stay local.
 */
const { app } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const DEFAULTS = {
  launchAtLogin: false,
  // Closing the window backgrounds the app so messages and calls keep
  // arriving. Off means the red button quits, the way a plain window does.
  backgroundOnClose: true,
  // Ring in a separate panel instead of pulling the whole app forward.
  ringPanel: true,
};

let cache = null;

const file = () => path.join(app.getPath('userData'), 'settings.json');

function all() {
  if (cache) return cache;

  try {
    cache = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(file(), 'utf8')) };
  } catch {
    cache = { ...DEFAULTS }; // first run, or the file got mangled
  }

  return cache;
}

const get = (key) => all()[key];

function set(key, value) {
  all()[key] = value;

  try {
    fs.writeFileSync(file(), JSON.stringify(cache, null, 2));
  } catch {
    // A preference that cannot be written is not worth interrupting anyone
    // over; it just reverts on next launch.
  }

  if (key === 'launchAtLogin') {
    app.setLoginItemSettings({ openAtLogin: value, openAsHidden: true });
  }

  return value;
}

/** Re-assert anything the OS holds outside our own file. */
function apply() {
  const wanted = get('launchAtLogin');
  if (app.getLoginItemSettings().openAtLogin !== wanted) {
    app.setLoginItemSettings({ openAtLogin: wanted, openAsHidden: true });
  }
}

module.exports = { get, set, all, apply, DEFAULTS };
