'use strict';

/*
 * The unread count drawn as a taskbar overlay icon.
 *
 * Windows has no dock badge. `app.setBadgeCount` is macOS and Linux only — it
 * returns false on Windows without doing anything — so the convention there,
 * the one Mail and Teams follow, is a small image stamped over the corner of
 * the taskbar button via `win.setOverlayIcon`.
 *
 * The trap that made this ship broken: the icon was built as an SVG data URL,
 * and `nativeImage` decodes PNG and JPEG only. An SVG produces an *empty* image
 * — 0x0, `isEmpty()` true — and `setOverlayIcon` accepts it without complaint
 * and draws nothing at all. Every part of the count pipeline worked; it was
 * discarded silently at the last step, which is why the number was never wrong,
 * just absent.
 *
 * So it has to be a PNG, and something has to rasterise one. There is no
 * drawing API in the main process and no canvas module here, but the app is
 * already running Chromium: the page draws it into a canvas and hands back a
 * PNG data URL, which nativeImage does decode. The canvas is detached and
 * never enters the document, so the portal sees nothing.
 */

const { nativeImage } = require('electron');

// Bigger than the 16px Windows asks for at 100%, so it stays clean on the
// 125% and 150% scaling most Windows laptops ship at.
const SIZE = 32;

// The same red the portal's own unread pill uses.
const RED = '#d21c1c';

// Long enough that a busy renderer still gets its drawing in, short enough that
// a window on its way out does not strand the promise. See the race below.
const DRAW_TIMEOUT = 2000;

/**
 * Rasterised icons, keyed by what is drawn on them. There are at most a hundred
 * distinct labels and each is a few KB, so they are worth keeping: the count
 * changes far more often than it takes new values, and every repeat would
 * otherwise be another round trip into the renderer.
 */
const cache = new Map();

/** Past 99 the digits stop being legible at 32px, so it caps. */
function label(count) {
  return count > 99 ? '99+' : String(count);
}

/**
 * @param {Electron.WebContents} webContents  the window whose page draws it
 * @param {number} count                      already clamped to > 0
 * @returns {Promise<Electron.NativeImage|null>}  null if the page could not draw
 */
async function image(webContents, count) {
  const text = label(count);

  if (cache.has(text)) return cache.get(text);
  if (!webContents || webContents.isDestroyed()) return null;

  // Three characters need a smaller face to fit inside the circle.
  const font = text.length > 2 ? 13 : 18;

  const source = `(() => {
    const canvas = document.createElement('canvas');
    canvas.width = ${SIZE};
    canvas.height = ${SIZE};

    const ctx = canvas.getContext('2d');

    ctx.fillStyle = ${JSON.stringify(RED)};
    ctx.beginPath();
    ctx.arc(${SIZE / 2}, ${SIZE / 2}, ${SIZE / 2 - 1}, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.font = '600 ${font}px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // Half a pixel down: 'middle' sits on the em box's centre, which reads
    // high for digits, whose ink sits on the baseline.
    ctx.fillText(${JSON.stringify(text)}, ${SIZE / 2}, ${SIZE / 2 + 0.5});

    return canvas.toDataURL('image/png');
  })()`;

  try {
    /*
     * Raced, not simply awaited.
     *
     * `executeJavaScript` on a window that has been destroyed never settles —
     * it does not resolve and it does not throw — and `isDestroyed()` on that
     * window's contents still answers false, so the guard above cannot catch
     * it. Verified, not assumed. Awaiting it bare means this promise hangs for
     * the life of the process, and every count that arrives while a window is
     * going away leaves another one behind.
     */
    const url = await Promise.race([
      webContents.executeJavaScript(source, true),
      new Promise((resolve) => { setTimeout(() => resolve(null), DRAW_TIMEOUT); }),
    ]);

    if (!url) return null;

    const icon = nativeImage.createFromDataURL(url);

    // Belt and braces: an empty image here is the very bug this file exists to
    // stop, and caching one would make it permanent for that count.
    if (icon.isEmpty()) return null;

    cache.set(text, icon);
    return icon;
  } catch {
    // A page that navigated mid-draw. The next count redraws it, and the tray
    // tooltip is carrying the same number in the meantime.
    return null;
  }
}

module.exports = { image, label, SIZE };
