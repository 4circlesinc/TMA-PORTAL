/*
 * Verifies that the taskbar overlay icon is a real image.
 *
 * The bug this exists to catch shipped and was invisible: the icon was built as
 * an SVG data URL, nativeImage decodes PNG and JPEG only, and the resulting
 * empty 0x0 image was handed to setOverlayIcon — which accepted it and drew
 * nothing. Nothing threw, nothing logged, and the count simply never appeared
 * on Windows. Checking that the image has pixels is the whole point.
 *
 * Runs anywhere. The drawing is Chromium's, not Windows', so a Mac can prove
 * the image is sound even though only Windows displays it.
 *
 * Run with: npm run test:badge
 */
const { app, BrowserWindow, nativeImage } = require('electron');

const badge = require('./badge');

let failures = 0;

function check(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: expected ${expected}, got ${actual}`);
}

setTimeout(() => {
  console.log('\nFAILED — timed out');
  app.exit(1);
}, 30000).unref();

// The last check closes the window on purpose. Without this, Electron's default
// quits the app there and the run ends silently on a pass it never printed.
app.on('window-all-closed', () => {});

app.whenReady().then(async () => {
  // The exact call the old code made, kept as a live demonstration of why the
  // rest of this file exists rather than a comment claiming it.
  const svg = nativeImage.createFromDataURL(
    `data:image/svg+xml;base64,${Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">'
      + '<circle cx="16" cy="16" r="15" fill="#d21c1c"/></svg>',
    ).toString('base64')}`,
  );
  check('nativeImage still cannot decode SVG (the trap)', svg.isEmpty(), true);

  const win = new BrowserWindow({ show: false, width: 400, height: 300 });
  await win.loadURL('data:text/html,<html><body></body></html>');

  check('label under 100 is the number', badge.label(7), '7');
  check('label over 99 caps', badge.label(388), '99+');

  for (const count of [1, 12, 388]) {
    const icon = await badge.image(win.webContents, count);

    check(`count ${count}: an image comes back`, !!icon, true);
    check(`count ${count}: it is not empty`, icon ? icon.isEmpty() : true, false);

    const size = icon ? icon.getSize() : { width: 0, height: 0 };
    check(`count ${count}: it is ${badge.SIZE}px square`,
      `${size.width}x${size.height}`, `${badge.SIZE}x${badge.SIZE}`);

    // A blank circle would pass every check above. The digits are white on red,
    // so white pixels somewhere in the middle band are the proof they drew.
    const png = icon ? icon.toBitmap() : Buffer.alloc(0);
    let white = 0;
    for (let i = 0; i < png.length; i += 4) {
      if (png[i] > 200 && png[i + 1] > 200 && png[i + 2] > 200 && png[i + 3] > 200) white += 1;
    }
    check(`count ${count}: the digits are drawn`, white > 10, true);
  }

  // Same count twice must not mean two round trips into the renderer.
  const first = await badge.image(win.webContents, 5);
  const second = await badge.image(win.webContents, 5);
  check('the same count is served from cache', first === second, true);

  // A destroyed page cannot draw, and must fail quietly rather than throw:
  // this runs on every notification arriving, including during a reload.
  // The handle is taken first because reading `.webContents` off a destroyed
  // window throws on its own, which would test Electron rather than badge.js.
  const contents = win.webContents;
  win.destroy();
  const afterClose = await badge.image(contents, 42);
  check('a dead page yields null, not a crash', afterClose, null);

  console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
  app.exit(failures ? 1 : 0);
});
