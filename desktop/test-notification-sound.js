'use strict';

/*
 * Settings → Notifications → Notification sound, in the Mac app: the banner
 * the page asks for is posted with the macOS alert sound chosen, silence
 * when asked, the default otherwise, and never a name off the list.
 *
 *   node test-notification-sound.js
 */
const Module = require('node:module');

let failures = 0;
const check = (label, ok) => { if (!ok) failures += 1; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); };

const posted = [];
class FakeNotification {
  static isSupported() { return true; }
  constructor(options) { this.options = options; this.handlers = {}; posted.push(this); }
  on(event, fn) { this.handlers[event] = fn; }
  show() { this.shown = true; }
}
const realLoad = Module._load;
Module._load = function load(request, ...rest) {
  if (request === 'electron') return { Notification: FakeNotification };
  if (request === './settings') return { get: () => true, set() {} };
  return realLoad.call(this, request, ...rest);
};
Object.defineProperty(process, 'platform', { value: 'darwin' });
const notifications = require('./notifications');
Module._load = realLoad;

check('every macOS alert sound is offered', notifications.SOUNDS.length === 14 && notifications.SOUNDS.includes('Glass') && notifications.SOUNDS.includes('Submarine'));

let clicked = 0;
notifications.show({ title: 'Dana', body: 'Signed the deed', sound: 'Glass' }, () => { clicked += 1; });
const glass = posted.at(-1);
check('a chosen sound plays by name', glass.options.sound === 'Glass' && glass.options.silent === false && glass.shown);
check('with the page\'s title and text', glass.options.title === 'Dana' && glass.options.body === 'Signed the deed');
glass.handlers.click();
check('a click reaches the page', clicked === 1);

notifications.show({ title: 't', sound: 'none' });
check('silent is silent', posted.at(-1).options.silent === true && !('sound' in posted.at(-1).options));

notifications.show({ title: 't', sound: 'default' });
check('default plays the Mac\'s default sound', posted.at(-1).options.silent === false && !('sound' in posted.at(-1).options));

notifications.show({ title: 't', sound: '../../../../tmp/evil' });
check('a name off the list is the default, never a path', !('sound' in posted.at(-1).options));

notifications.preview('Hero');
check('the settings preview plays the sound it names', posted.at(-1).options.sound === 'Hero' && /sound/.test(posted.at(-1).options.title));

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
