'use strict';

/*
 * The Mac App Store build: what Apple checks at upload and in review, held
 * in place without needing a certificate to find out.
 *
 *   npm run test:mas
 */
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

let failures = 0;
function check(label, ok) {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
}

function loadConfig(env) {
  const saved = {};
  for (const key of Object.keys(env)) { saved[key] = process.env[key]; process.env[key] = env[key]; }
  delete require.cache[require.resolve('./electron-builder.mas.cjs')];
  const config = require('./electron-builder.mas.cjs');
  for (const key of Object.keys(env)) {
    if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
  }
  return config;
}

const config = loadConfig({});
const base = require('./package.json').build;

check('the store build targets mas, universal for Intel and Apple silicon',
  JSON.stringify(config.mac.target) === JSON.stringify([{ target: 'mas', arch: ['universal'] }]));
check('the store build searches the keychain for its own certificates',
  !('identity' in config.mac) && config.mas.identity === undefined);
check('MAS_UNSIGNED builds an unsigned .app to try locally',
  loadConfig({ MAS_UNSIGNED: '1' }).mas.identity === null);
check('MAS_IDENTITY picks a certificate',
  loadConfig({ MAS_IDENTITY: 'Apple Distribution: Example (ABCDE12345)' }).mas.identity === 'Apple Distribution: Example (ABCDE12345)');
check('the hardened runtime of the direct download is turned off',
  config.mas.hardenedRuntime === false);
check('nothing is published to the portal update feed',
  config.publish === null);
check('and the store .pkg is built outside release/, which desktop:publish uploads',
  config.directories.output === 'release-mas' && base.directories.output === 'release');
check('same bundle ID as the iOS app, so both share one App Store record',
  config.appId === 'com.tmantoinelaw.portal');
check('the direct download signs with Developer ID only, never a development certificate',
  !('identity' in base.mac) && base.mac.type === 'distribution' && base.mac.hardenedRuntime === true && !base.mas);
check('export compliance is answered in the bundle',
  config.mas.extendInfo.ITSAppUsesNonExemptEncryption === false);
check('the camera, microphone and location prompts still have their reasons',
  ['NSCameraUsageDescription', 'NSMicrophoneUsageDescription', 'NSLocationWhenInUseUsageDescription']
    .every((key) => typeof config.mac.extendInfo[key] === 'string' && config.mac.extendInfo[key].length > 10));

function plistKeys(file) {
  const text = fs.readFileSync(path.join(__dirname, file), 'utf8');
  const keys = new Map();
  for (const m of text.matchAll(/<key>([^<]+)<\/key>\s*<(true|false)\/>/g)) keys.set(m[1], m[2] === 'true');
  return keys;
}

const parent = plistKeys(config.mas.entitlements);
check('the app runs in the App Sandbox', parent.get('com.apple.security.app-sandbox') === true);
for (const [key, why] of [
  ['com.apple.security.network.client', 'reach the portal'],
  ['com.apple.security.device.camera', 'video calls'],
  ['com.apple.security.device.audio-input', 'calls'],
  ['com.apple.security.personal-information.location', 'office or remote presence'],
  ['com.apple.security.files.user-selected.read-write', 'attach and save files'],
  ['com.apple.security.files.downloads.read-write', 'downloads'],
  ['com.apple.security.print', 'printing'],
]) {
  check(`sandbox allows ${why}`, parent.get(key) === true);
}
check('and nothing a sandboxed store app is refused for',
  !parent.has('com.apple.security.cs.disable-library-validation')
  && !parent.has('com.apple.security.cs.allow-unsigned-executable-memory')
  && !parent.has('com.apple.security.network.server'));

const child = plistKeys(config.mas.entitlementsInherit);
check('helpers inherit the app sandbox',
  child.get('com.apple.security.app-sandbox') === true && child.get('com.apple.security.inherit') === true);

const masSign = require('./mas-sign');
check('the store build signs with the certificate its profile lists',
  config.mas.sign === './mas-sign.js' && typeof masSign.sign === 'function');
{
  const der = (text) => Buffer.from(text).toString('base64');
  const sha1 = (text) => require('node:crypto').createHash('sha1').update(text).digest('hex').toUpperCase();
  const xml = `<plist><dict><key>DeveloperCertificates</key><array><data>\n${der('cert-841D')}\n</data></array><key>Name</key><string>x</string></dict></plist>`;
  const wanted = masSign.certificatesIn(xml);
  check('the profile\'s certificates are read by fingerprint', JSON.stringify(wanted) === JSON.stringify([sha1('cert-841D')]));
  check('a certificate the profile lists is kept',
    masSign.identityFor(sha1('cert-841D'), wanted, [sha1('cert-A0DD'), sha1('cert-841D')]) === sha1('cert-841D'));
  check('one it does not list is swapped for one it does',
    masSign.identityFor(sha1('cert-A0DD'), wanted, [sha1('cert-A0DD'), sha1('cert-841D')]) === sha1('cert-841D'));
  check('and with none of its certificates installed there is nothing to sign with',
    masSign.identityFor(sha1('cert-A0DD'), wanted, [sha1('cert-A0DD')]) === null);
}

const helper = plistKeys(config.mas.entitlementsLoginHelper);
check('the login helper has a sandbox of its own, since launchd starts it',
  helper.get('com.apple.security.app-sandbox') === true && !helper.has('com.apple.security.inherit'));

/*
 * The updater in a store build: never checks, never offers. Loaded with a
 * stand-in for electron, since only process.mas decides it.
 */
const calls = [];
const fakeElectron = {
  app: { isPackaged: true, getPath: () => '/tmp', getVersion: () => '0.0.0', on() {} },
  dialog: { showMessageBox: (...args) => { calls.push(['dialog', args]); return Promise.resolve({ response: 0 }); } },
  shell: {},
  BrowserWindow: Object.assign(function BrowserWindow() {}, { getAllWindows: () => [] }),
  ipcMain: { handle() {}, on() {}, removeHandler() {} },
  screen: {},
  nativeTheme: { shouldUseDarkColors: false, on() {} },
  net: {},
};
const realLoad = Module._load;
Module._load = function load(request, ...rest) {
  if (request === 'electron') return fakeElectron;
  return realLoad.call(this, request, ...rest);
};
const realFetch = global.fetch;
global.fetch = (...args) => { calls.push(['fetch', args]); return Promise.reject(new Error('no network in this test')); };
const realSetTimeout = global.setTimeout;
const realSetInterval = global.setInterval;
global.setTimeout = (...args) => { calls.push(['setTimeout']); return { unref() {} }; };
global.setInterval = (...args) => { calls.push(['setInterval']); return { unref() {} }; };

Object.defineProperty(process, 'mas', { value: true, configurable: true });

(async () => {
  try {
    const updater = require('./updater');
    check('the updater knows it is a store build', updater.STORE_BUILD === true);
    updater.start();
    const release = await updater.checkForUpdates({ silent: false });
    check('a store build schedules no update checks',
      !calls.some(([kind]) => kind === 'setTimeout' || kind === 'setInterval'));
    check('and Check for Updates neither fetches the feed nor shows a dialog',
      release === null && !calls.some(([kind]) => kind === 'fetch' || kind === 'dialog'));
  } catch (err) {
    check(`the updater loads under a store build (${err.message})`, false);
  } finally {
    Module._load = realLoad;
    global.fetch = realFetch;
    global.setTimeout = realSetTimeout;
    global.setInterval = realSetInterval;
    delete process.mas;
  }

  const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
  check('Check for Updates is hidden from the menus of a store build',
    /function checkForUpdatesItem\(\)[\s\S]{0,400}visible: !updater\.STORE_BUILD/.test(main));

  const preload = fs.readFileSync(path.join(__dirname, 'preload.js'), 'utf8');
  check('the page is told it is in the store build, so it hides other downloads',
    /store: process\.mas \? 'mac-app-store' : null/.test(preload));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})();
