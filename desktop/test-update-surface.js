/*
 * The Windows half of the two update panels.
 *
 * Every bug this guards against was shipped from a Mac, where none of it is
 * reachable by looking: the panels are correct here, and were blank white
 * rectangles there. So the platform is a parameter rather than something read
 * from the process, and these run the Windows branch on macOS.
 *
 * The check that matters most is the last kind — that the colour the window is
 * made with and the colour the page paints are the same value. They live in two
 * files, in two languages, and nothing but this test connects them.
 *
 * Run with: npm run test:update-surface
 */
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const { surfaceOptions, reveal, SURFACE } = require('./update-surface');
const updater = require('./updater');

let failures = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
};

const read = (file) => fs.readFileSync(path.join(__dirname, file), 'utf8');

/** A stand-in BrowserWindow that records what was done to it, in order. */
function fakeWindow({ focusTakes }) {
  const calls = [];
  let focused = false;

  return {
    calls,
    isDestroyed: () => false,
    isFocused: () => focused,
    show() { calls.push('show'); },
    focus() { calls.push('focus'); focused = focusTakes; },
    setAlwaysOnTop(on) { calls.push(`alwaysOnTop:${on}`); },
    flashFrame(on) { calls.push(`flashFrame:${on}`); },
    once(event) { calls.push(`once:${event}`); },
  };
}

setTimeout(() => { console.log('\nFAILED — timed out'); app.exit(1); }, 60000).unref();

app.whenReady().then(async () => {
 try {
  /* ── macOS keeps its glass ──────────────────────────────────────── */
  const mac = surfaceOptions('darwin', false);
  check('macOS stays transparent', mac.transparent, true);
  check('macOS keeps its vibrancy', mac.vibrancy, 'under-window');
  check('macOS stays lively while unfocused', mac.visualEffectState, 'active');
  check('macOS keeps the traffic lights', mac.trafficLightPosition, { x: 13, y: 13 });

  /* ── Windows gets a surface it can actually see ─────────────────── */
  const light = surfaceOptions('win32', false);
  const dark = surfaceOptions('win32', true);

  // The bug: acrylic is honoured only on Windows 11 22H2 and up, and only when
  // backgroundColor is transparent. It was neither, so nothing ever drew it.
  check('Windows asks for no material it may not get', 'backgroundMaterial' in light, false);
  check('Windows is never transparent', 'transparent' in light, false);
  check('Windows is opaque in light mode', light.backgroundColor, SURFACE.light);
  check('Windows is opaque in dark mode', dark.backgroundColor, SURFACE.dark);

  // Was '#00000000' — a transparent caption strip over a window that turned out
  // to be white, which is how the close button became grey on grey.
  check('caption strip carries the real surface', light.titleBarOverlay.color, SURFACE.light);
  check('caption strip follows dark mode', dark.titleBarOverlay.color, SURFACE.dark);
  check('caption glyphs invert for dark', dark.titleBarOverlay.symbolColor !== light.titleBarOverlay.symbolColor, true);

  /* ── the window and the page have to agree ──────────────────────── */
  for (const page of ['update-window.html', 'update-available.html']) {
    const css = read(page);

    check(`${page} paints a Windows surface`,
      /:root\[data-platform="win32"\][\s\S]*?background:\s*light-dark\(([^)]*)\)/.test(css), true);

    const [, light_, dark_] = css
      .match(/:root\[data-platform="win32"\][\s\S]*?background:\s*light-dark\(\s*([^,\s]+)\s*,\s*([^)\s]+)\s*\)/) || [];

    check(`${page} light surface matches the window`, light_, SURFACE.light);
    check(`${page} dark surface matches the window`, dark_, SURFACE.dark);

    // Nothing paints until the page knows which platform it is on.
    check(`${page} stamps the platform on :root`, /dataset\.platform\s*=/.test(css), true);
  }

  /* ── being seen ─────────────────────────────────────────────────── */
  const onMac = fakeWindow({ focusTakes: true });
  reveal(onMac, 'darwin');
  // Exactly what it did before this module existed. macOS was never the broken
  // platform, and taking the foreground there would interrupt real work.
  check('macOS is left exactly as it was', onMac.calls, ['show']);

  // Windows will not hand the foreground to a tray app, so the window is lifted
  // over it and the pin dropped again immediately.
  const won = fakeWindow({ focusTakes: true });
  reveal(won, 'win32');
  check('Windows lifts the window over the foreground app',
    won.calls, ['alwaysOnTop:true', 'show', 'alwaysOnTop:false', 'focus']);

  // And when even that is refused, the taskbar button flashes — the one thing
  // Windows always allows, and it keeps flashing until the window is looked at.
  const refused = fakeWindow({ focusTakes: false });
  reveal(refused, 'win32');
  check('a refused foreground flashes the taskbar button',
    refused.calls, ['alwaysOnTop:true', 'show', 'alwaysOnTop:false', 'focus', 'flashFrame:true', 'once:focus']);

  // A destroyed window is not an error; the update carries on without a panel.
  reveal({ isDestroyed: () => true }, 'win32');
  check('a destroyed panel is left alone', true, true);

  /* ── the installer flags ────────────────────────────────────────── */
  // --updated is what tells electron-builder's assisted installer this is an
  // update: without it keep-shortcuts is switched off and every silent update
  // recreates the shortcuts, orphaning a pinned taskbar entry.
  check('the installer is told this is an update', updater.INSTALLER_ARGS.includes('--updated'), true);
  check('the installer runs silently', updater.INSTALLER_ARGS.includes('/S'), true);
  check('the app is relaunched afterwards', updater.INSTALLER_ARGS.includes('--force-run'), true);

  /* ── and the real windows still open here ───────────────────────── */
  const updateWindow = require('./update-window');
  updateWindow.show('9.9.9');
  await new Promise((r) => setTimeout(r, 1500));

  const panel = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed()).pop();
  check('the progress panel opens', !!panel && panel.isVisible(), true);
  check('the page knows its platform',
    await panel.webContents.executeJavaScript('document.documentElement.dataset.platform', true),
    process.platform);
  check('the page has a background it can rely on',
    await panel.webContents.executeJavaScript(
      "getComputedStyle(document.querySelector('.screen')).backgroundColor !== ''", true), true);
  updateWindow.close();

  console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
  app.exit(failures ? 1 : 0);
 } catch (error) {
  console.log(`\nFAILED — ${error.message}`);
  app.exit(1);
 }
});
