'use strict';

/*
 * How the two update panels are made and put on screen.
 *
 * Both windows — the offer and the progress screen — were built as macOS
 * vibrancy panels: a transparent window with `background: transparent` all the
 * way down, letting the system material behind it be the surface. That is the
 * right thing on a Mac and it is why they look like part of the OS.
 *
 * Off the Mac it left them invisible. Two separate reasons, and both had to be
 * fixed together:
 *
 *   - `backgroundMaterial: 'acrylic'` is honoured only on Windows 11 22H2 and
 *     up, and only when the window's `backgroundColor` is itself transparent.
 *     It was never set, so it defaulted to opaque white and the material never
 *     drew on any Windows at all.
 *   - The pages pick their text colour with `light-dark()`, which follows the
 *     OS. A Windows machine in dark mode therefore painted near-white text on
 *     that white window: a panel that is on screen, correct, and completely
 *     unreadable. The same shape as the blank blue sign-in window fixed in
 *     0.8.28.
 *
 * So Windows gets an opaque surface it paints itself, in the theme the OS is
 * actually in. A material that is sometimes there is worse than a plain
 * surface that is always right.
 *
 * The other half is being seen at all. `show()` is enough on macOS. Windows
 * refuses the foreground to a process that does not already have it — and this
 * app's normal state is a hidden window and a tray icon — so an update offer
 * could open behind everything the user was doing with nothing but a taskbar
 * blink to say so.
 */

const IS_MAC = process.platform === 'darwin';

/** The Windows surface, light and dark. Matched by the pages in CSS. */
const SURFACE = { light: '#f6f6f6', dark: '#202020' };

/** The caption glyphs Windows draws over our titleBarOverlay. */
const SYMBOL = { light: '#5a5a5a', dark: '#d0d0d0' };

/**
 * The BrowserWindow options that decide what the panel is made of.
 *
 * Pure, and taking the platform rather than reading it, so the Windows branch
 * can be tested from a Mac — which is where this project is built and where
 * every one of these bugs was shipped from.
 *
 * @param {string} platform  process.platform
 * @param {boolean} dark     nativeTheme.shouldUseDarkColors
 */
function surfaceOptions(platform, dark) {
  if (platform === 'darwin') {
    return {
      /*
       * `vibrancy` is what makes the panel a real system material rather than a
       * painted-on approximation: macOS blurs and tints whatever is behind the
       * window, so it picks up the desktop and follows light/dark on its own.
       * It needs a transparent window — anything opaque, including a
       * `backgroundColor`, is drawn *over* the material and flattens it back to
       * a rectangle.
       *
       * `visualEffectState: 'active'` keeps it lively while the window is
       * unfocused, which is the normal case here: an update runs while the user
       * is in another app, and the default would grey the material out for the
       * whole download.
       */
      transparent: true,
      backgroundColor: '#00000000',
      vibrancy: 'under-window',
      visualEffectState: 'active',
      // Hidden, not absent: the traffic lights stay, drawn over the glass, so
      // this is an ordinary window you can close or send to the Dock rather
      // than a panel that traps you until it decides to go.
      titleBarStyle: 'hidden',
      trafficLightPosition: { x: 13, y: 13 },
    };
  }

  const surface = dark ? SURFACE.dark : SURFACE.light;

  return {
    // Opaque, and the same value the page paints, so the window is never
    // white for a frame before the first paint lands.
    backgroundColor: surface,
    titleBarStyle: 'hidden',
    // Was '#00000000'. A transparent overlay over a window that turned out to
    // be white is how the close button ended up as grey-on-grey; the overlay
    // is painted, not blended, so it has to carry the real surface colour.
    titleBarOverlay: { color: surface, symbolColor: dark ? SYMBOL.dark : SYMBOL.light, height: 34 },
  };
}

/**
 * Puts the panel in front of the person it is asking a question of.
 *
 * `win.show()` alone is the macOS answer. On Windows the shell will not hand
 * the foreground to a process that does not already hold it, and a tray app
 * never does — so the window opens *behind* whatever is in front, and the only
 * sign of it is a taskbar button the user was not looking at. An update nobody
 * sees is an update nobody installs.
 *
 * The order matters. `alwaysOnTop` around the show is what gets the window
 * placed above the foreground app; it is dropped again immediately, because
 * this is something to watch or ignore, not something to pin over other work.
 * `flashFrame` is the honest fallback for when even that is refused: Windows
 * always allows the taskbar button to flash, and it keeps flashing until the
 * window is looked at.
 *
 * @param {object} win       a BrowserWindow, or anything with the same methods
 * @param {string} platform  process.platform
 */
function reveal(win, platform) {
  if (!win || win.isDestroyed()) return;

  // Unchanged on macOS, deliberately: show() already focuses a new window
  // within the app, and anything stronger — app.focus({steal: true}) — would
  // yank the keyboard out of whatever the user is typing in another app for
  // something they are allowed to ignore.
  if (platform === 'darwin') {
    win.show();
    return;
  }

  win.setAlwaysOnTop(true);
  win.show();
  win.setAlwaysOnTop(false);
  win.focus();

  // Only when the foreground was actually refused — flashing a window the user
  // is already looking at is noise.
  if (!win.isFocused()) {
    win.flashFrame(true);
    win.once('focus', () => {
      if (!win.isDestroyed()) win.flashFrame(false);
    });
  }
}

module.exports = { surfaceOptions, reveal, SURFACE, SYMBOL, IS_MAC };
