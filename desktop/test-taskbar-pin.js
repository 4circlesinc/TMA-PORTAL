/*
 * Verifies who gets asked to pin the app to the taskbar.
 *
 * The dialog itself is not what needs testing — it is three lines of Electron.
 * What needs testing is the decision in front of it, because every wrong answer
 * is one people notice: asking a Mac user about a taskbar, asking again after
 * every update, or asking someone who pinned the app months ago. The ask is
 * once, ever, on Windows, after a fresh install.
 *
 * Run with: npm run test:taskbar-pin
 */
const { app } = require('electron');

const taskbarPin = require('./taskbar-pin');
const settings = require('./settings');

let failures = 0;

function check(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: expected ${expected}, got ${actual}`);
}

setTimeout(() => {
  console.log('\nFAILED — timed out');
  app.exit(1);
}, 20000).unref();

/*
 * The decision reads process.platform, app.isPackaged and process.argv, none of
 * which a test can be honest about from a Mac dev run. They are stubbed for the
 * duration and put back, so what is under test is the branching itself.
 */
function withEnvironment({ platform, packaged, argv }, run) {
  const realPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  const realArgv = process.argv;
  const realPackaged = Object.getOwnPropertyDescriptor(app, 'isPackaged');

  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
  Object.defineProperty(app, 'isPackaged', { value: packaged, configurable: true });
  process.argv = argv;

  try {
    return run();
  } finally {
    Object.defineProperty(process, 'platform', realPlatform);
    if (realPackaged) Object.defineProperty(app, 'isPackaged', realPackaged);
    process.argv = realArgv;
  }
}

const WINDOWS = { platform: 'win32', packaged: true, argv: ['app.exe'] };

app.whenReady().then(() => {
  // A prompt already made is recorded in settings, which persist — so every
  // case below starts from a known state rather than from whatever this
  // machine happens to have.
  settings.set('taskbarPinPrompted', false);

  check('a fresh Windows install is asked',
    withEnvironment(WINDOWS, () => taskbarPin.promptOnFirstRun()), true);

  // That call recorded the ask; a second launch must not repeat it.
  check('and is not asked twice',
    withEnvironment(WINDOWS, () => taskbarPin.promptOnFirstRun()), false);

  settings.set('taskbarPinPrompted', false);

  check('an update relaunch is not asked',
    withEnvironment({ ...WINDOWS, argv: ['app.exe', '--updated'] },
      () => taskbarPin.promptOnFirstRun()), false);

  check('macOS is never asked',
    withEnvironment({ ...WINDOWS, platform: 'darwin' },
      () => taskbarPin.promptOnFirstRun()), false);

  check('a dev run is not asked',
    withEnvironment({ ...WINDOWS, packaged: false },
      () => taskbarPin.promptOnFirstRun()), false);

  // Deciding is a check against the filesystem, and on a machine with no such
  // folder it has to answer "not pinned" rather than throw on the launch path.
  check('the pinned check survives having no taskbar folder',
    typeof taskbarPin.isPinned(), 'boolean');

  // Left as found, so running the suite does not silence the real prompt on a
  // machine that has never been asked.
  settings.set('taskbarPinPrompted', false);

  console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
  app.exit(failures ? 1 : 0);
});
