'use strict';

/*
 * The right-click menu.
 *
 * Electron ships none. Not "a plain one" — none at all: right-clicking
 * anywhere in the app did nothing whatsoever, which is a thing no native
 * application on either platform does and the single loudest way this reads as
 * a web page in a frame. A browser at least offers its own; we had removed
 * that and put nothing back.
 *
 * WHAT IT OFFERS IS WHAT WAS CLICKED
 *
 * One menu that reads the click rather than five menus that guess. A text
 * field gets the editing commands and the spelling suggestions; a link gets
 * the link commands; an image gets the image commands; a selection gets Copy.
 * Nothing else appears, because a menu of eleven greyed-out items is how you
 * tell somebody the app was assembled rather than designed.
 *
 * ROLES, NOT HAND-ROLLED CLICKS
 *
 * `role: 'copy'` is the operating system's own Copy — it carries the platform
 * accelerator, the platform label in the user's own language, and the correct
 * enabled state. Wiring `webContents.copy()` by hand gets an English label
 * with no shortcut next to it, which looks subtly wrong in a way that is hard
 * to point at and easy to feel.
 *
 * SPELLING IS THE POINT OF THE EXERCISE
 *
 * `spellcheck: true` has been on in the window options all along, so Chromium
 * has been underlining misspellings in every message and every email the firm
 * has written — and there was no way to reach a single suggestion. The red
 * line was decoration. This is what connects it.
 */

const { Menu, MenuItem, clipboard, shell, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

/* At most this many suggestions. Chromium offers up to a dozen and a menu
   that long buries the commands underneath it. */
const MAX_SUGGESTIONS = 5;

/**
 * Attach the menu to a window's contents.
 *
 * @param {Electron.WebContents} contents
 * @param {object} [opts]
 * @param {(url: string) => void} [opts.openExternally] how this app opens a
 *   link outside itself; defaults to the shell.
 */
function install(contents, opts = {}) {
  if (!contents || contents.isDestroyed?.()) return false;

  const openExternally = opts.openExternally
    || (url => { shell.openExternal(url).catch(() => {}); });

  contents.on('context-menu', (event, params) => {
    const menu = build(contents, params, openExternally);
    // An empty menu is not a menu. Right-clicking blank space in a native app
    // usually does nothing, and popping up a bare frame is worse than that.
    if (menu.items.length === 0) return;
    menu.popup({ window: contents.getOwnerBrowserWindow?.() || undefined });
  });

  return true;
}

/** @returns {Electron.Menu} */
function build(contents, params, openExternally) {
  const menu = new Menu();
  const add = item => menu.append(new MenuItem(item));
  const sep = () => {
    // Never a leading or a doubled separator: a menu that opens with a line
    // across the top is the tell that the section above it was empty.
    if (menu.items.length && menu.items[menu.items.length - 1].type !== 'separator') {
      menu.append(new MenuItem({ type: 'separator' }));
    }
  };

  spelling(menu, contents, params, add, sep);

  if (params.isEditable) {
    sep();
    add({ role: 'undo' });
    add({ role: 'redo' });
    sep();
    add({ role: 'cut' });
    add({ role: 'copy' });
    add({ role: 'paste' });
    // The one every writing app has and no wrapper remembers: pasting a
    // quoted paragraph out of Word should not drag Word's fonts in with it.
    add({ role: 'pasteAndMatchStyle', label: 'Paste and Match Style' });
    sep();
    add({ role: 'selectAll' });
  } else if (params.selectionText && params.selectionText.trim()) {
    sep();
    add({ role: 'copy' });
  }

  link(params, add, sep, openExternally);
  media(contents, params, add, sep);

  return menu;
}

function spelling(menu, contents, params, add, sep) {
  const misspelled = params.misspelledWord;
  if (!misspelled) return;

  const suggestions = (params.dictionarySuggestions || []).slice(0, MAX_SUGGESTIONS);

  suggestions.forEach(word => {
    add({ label: word, click: () => contents.replaceMisspelling(word) });
  });

  if (!suggestions.length) {
    // Said, not hidden. A word with no suggestions and no menu entry looks
    // like the spell checker failed rather than gave up.
    add({ label: 'No spelling suggestions', enabled: false });
  }

  sep();
  add({
    label: 'Add to Dictionary',
    click: () => contents.session.addWordToSpellCheckerDictionary(misspelled),
  });
}

function link(params, add, sep, openExternally) {
  if (!params.linkURL) return;

  sep();
  add({ label: 'Copy Link', click: () => clipboard.writeText(params.linkURL) });
  add({ label: 'Open Link in Browser', click: () => openExternally(params.linkURL) });
}

function media(contents, params, add, sep) {
  if (params.mediaType !== 'image' || !params.srcURL) return;

  sep();
  add({ label: 'Copy Image', click: () => contents.copyImageAt(params.x, params.y) });
  add({ label: 'Copy Image Address', click: () => clipboard.writeText(params.srcURL) });
  add({
    label: 'Save Image As…',
    click: () => saveImage(contents, params.srcURL),
  });
}

/**
 * Write an image the reader right-clicked to a file they choose.
 *
 * `data:` is handled here rather than downloaded: a passport photo drawn from
 * a preview is a data URI, and asking the network for it would fetch nothing.
 * Everything else goes through the window's own session, because portal
 * images are behind the sign-in and an anonymous request gets a 404.
 */
function saveImage(contents, srcURL) {
  const window = contents.getOwnerBrowserWindow?.() || undefined;

  dialog.showSaveDialog(window, {
    title: 'Save Image',
    defaultPath: suggestedName(srcURL),
  }).then(({ canceled, filePath }) => {
    if (canceled || !filePath) return;

    if (srcURL.startsWith('data:')) {
      const comma = srcURL.indexOf(',');
      const meta = srcURL.slice(0, comma);
      const body = srcURL.slice(comma + 1);
      const buffer = meta.includes(';base64')
        ? Buffer.from(body, 'base64')
        : Buffer.from(decodeURIComponent(body), 'utf8');
      fs.writeFileSync(filePath, buffer);

      return;
    }

    contents.session.fetch(srcURL)
      .then(res => (res.ok ? res.arrayBuffer() : Promise.reject(new Error(String(res.status)))))
      .then(buf => fs.writeFileSync(filePath, Buffer.from(buf)))
      .catch(err => {
        dialog.showMessageBox(window, {
          type: 'warning',
          message: 'Could not save this image',
          detail: String(err && err.message ? err.message : err),
        });
      });
  }).catch(() => { /* the dialog itself failing is not worth a second dialog */ });
}

function suggestedName(srcURL) {
  try {
    const name = path.basename(new URL(srcURL).pathname);

    return name && path.extname(name) ? name : 'image.png';
  } catch {
    return 'image.png';
  }
}

module.exports = { install, build, suggestedName };
