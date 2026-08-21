/*
 * One colour from the first frame to the portal.
 *
 * Windows draws the minimise/maximise/close buttons itself, in a block of
 * `titleBarOverlay.color` at the top right, painted over whatever the web
 * contents have drawn. That colour was fixed at the brand blue while the
 * loading layer underneath was the darker #136da0 — so every Windows cold start
 * opened with a bright blue rectangle in the corner, on a dark blue window,
 * until the portal finished painting. macOS never showed it: there the bar is
 * drawn in the page, so there is nothing separate to keep in step.
 *
 * The colour now lives in four places that have to agree — splash.js, the
 * splash's own markup, the window's backgroundColor, and the caption strip —
 * and nothing but this test connects them.
 *
 * Run with: npm run test:splash-colour
 */
const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const splash = require('./splash');
const titlebar = require('./titlebar');

let failures = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
};

const read = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');

setTimeout(() => { console.log('\nFAILED — timed out'); app.exit(1); }, 30000).unref();

app.whenReady().then(() => {
 try {
  const surface = splash.SURFACE;

  check('the splash surface is a hex colour', /^#[0-9a-f]{6}$/i.test(surface), true);

  /* ── the markup paints what the view paints ─────────────────────── */
  // splash.html sets the body background; the view sets its own behind that.
  // A mismatch shows as a band at whichever edge the body does not cover.
  const html = read('splash.html');
  const body = (html.match(/background:\s*(#[0-9a-f]{6})/i) || [])[1];
  check('splash.html paints the same surface', (body || '').toLowerCase(), surface.toLowerCase());

  /* ── the window opens on it ─────────────────────────────────────── */
  // Otherwise the first frame is one colour and the layer drawn immediately
  // after is another, which reads as a flash rather than a load.
  const mainSrc = read('main.js');
  check('the window backgroundColor is the splash surface',
    /backgroundColor:\s*splash\.SURFACE/.test(mainSrc), true);

  /* ── and the caption strip follows it ───────────────────────────── */
  const splashSrc = read('splash.js');
  check('the strip is repainted when the layer goes up',
    /titlebar\.setOverlayColor\(win,\s*SURFACE\)/.test(splashSrc), true);
  check('and restored to the bar colour when it comes down',
    /titlebar\.setOverlayColor\(win,\s*titlebar\.BLUE\)/.test(splashSrc), true);

  // The restore has to happen where the layer is actually removed, not where
  // the fade starts: the view keeps painting SURFACE through the fade, so an
  // early flip moves the mismatch rather than removing it.
  const restoreAt = splashSrc.indexOf('titlebar.setOverlayColor(win, titlebar.BLUE)');
  const fadeStart = splashSrc.indexOf("classList.add('is-leaving')");
  const removal = splashSrc.indexOf('removeChildView');
  check('restored after the fade begins', restoreAt > fadeStart, true);
  check('and no later than the layer being removed', restoreAt < removal, true);

  /* ── the two blues really are different ─────────────────────────── */
  // If these were ever made equal this whole test would pass vacuously.
  check('the bar blue and the splash surface are genuinely different',
    titlebar.BLUE.toLowerCase() !== surface.toLowerCase(), true);

  /* ── and the strip is a no-op on macOS ──────────────────────────── */
  // setTitleBarOverlay does not exist there; this must not throw on the
  // platform the app is built on.
  titlebar.setOverlayColor(null, surface);
  titlebar.setOverlayColor({ isDestroyed: () => true }, surface);
  check('recolouring a missing window is harmless', true, true);

  console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
  app.exit(failures ? 1 : 0);
 } catch (error) {
  console.log(`\nFAILED — ${error.message}`);
  app.exit(1);
 }
});
