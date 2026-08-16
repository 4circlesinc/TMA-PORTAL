/*
 * The right-click menu: that it offers what was clicked, and nothing else.
 *
 * The assertions worth having are the absences. A menu that always shows the
 * same eleven items, most of them greyed out, is how an app announces it was
 * assembled rather than designed — so what is checked here is that a plain
 * paragraph does not offer Paste, that a link does not offer Save Image, and
 * that right-clicking empty space offers nothing at all rather than popping up
 * an empty frame.
 *
 * The spelling half is checked because it is the reason this exists. The
 * window has had `spellcheck: true` all along, so Chromium has been underlining
 * misspellings the reader had no way to act on; a misspelled word must produce
 * its suggestions AND Add to Dictionary.
 *
 * Run with: npm run test:context-menu
 */
const { app } = require('electron');

const contextMenu = require('./context-menu');

let failures = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
};

setTimeout(() => { console.log('\nFAILED — timed out'); app.exit(1); }, 30000).unref();

/* Enough of a WebContents for the menu to be built against. */
const contents = {
  isDestroyed: () => false,
  getOwnerBrowserWindow: () => undefined,
  session: { addWordToSpellCheckerDictionary() {} },
  replaceMisspelling() {},
  copyImageAt() {},
};

const labels = menu => menu.items.map(i => (i.type === 'separator' ? '—' : (i.label || i.role)));
const roles = menu => menu.items.map(i => i.role).filter(Boolean);

app.whenReady().then(() => {
  const build = params => contextMenu.build(contents, params, () => {});

  /* ── nothing clicked ────────────────────────────────────────────── */

  const blank = build({ isEditable: false, selectionText: '', mediaType: 'none' });
  check('empty space offers no menu', blank.items.length, 0);

  /* ── a text field ───────────────────────────────────────────────── */

  const field = build({ isEditable: true, selectionText: '', mediaType: 'none' });
  // Lower-cased on the way in: Electron normalises `pasteAndMatchStyle` to
  // `pasteandmatchstyle` on the built item, so comparing what we wrote against
  // what we get back fails on the two camel-cased roles and nothing else.
  const fieldRoles = roles(field);
  check('a text field offers the editing commands',
    ['undo', 'redo', 'cut', 'copy', 'paste', 'pasteandmatchstyle', 'selectall']
      .every(r => fieldRoles.includes(r)), true);
  check('and it does not open on a separator', field.items[0].type !== 'separator', true);

  /* ── read-only text ─────────────────────────────────────────────── */

  const selected = build({ isEditable: false, selectionText: 'Nadia Kassem', mediaType: 'none' });
  check('selected text offers Copy', roles(selected), ['copy']);
  check('and not Paste', roles(selected).includes('paste'), false);

  const unselected = build({ isEditable: false, selectionText: '   ', mediaType: 'none' });
  check('whitespace is not a selection', unselected.items.length, 0);

  /* ── a link ─────────────────────────────────────────────────────── */

  const link = build({
    isEditable: false, selectionText: '', mediaType: 'none',
    linkURL: 'https://portal.tmantoinelaw.com/clients',
  });
  check('a link offers its own two commands',
    labels(link), ['Copy Link', 'Open Link in Browser']);

  /* ── an image ───────────────────────────────────────────────────── */

  const image = build({
    isEditable: false, selectionText: '', mediaType: 'image',
    srcURL: 'https://portal.tmantoinelaw.com/media/avatars/x.jpg', x: 10, y: 10,
  });
  check('an image offers the image commands',
    labels(image), ['Copy Image', 'Copy Image Address', 'Save Image As…']);
  check('and a link does not', labels(link).includes('Save Image As…'), false);

  /* ── spelling ───────────────────────────────────────────────────── */

  const misspelled = build({
    isEditable: true, selectionText: 'recieve', mediaType: 'none',
    misspelledWord: 'recieve',
    dictionarySuggestions: ['receive', 'relieve', 'reprieve'],
  });
  const spellLabels = labels(misspelled);
  check('suggestions come first, where a reader looks',
    spellLabels.slice(0, 3), ['receive', 'relieve', 'reprieve']);
  check('with Add to Dictionary under them',
    spellLabels.includes('Add to Dictionary'), true);
  check('and the editing commands still below',
    roles(misspelled).includes('paste'), true);

  const noIdeas = build({
    isEditable: true, selectionText: 'zzxq', mediaType: 'none',
    misspelledWord: 'zzxq', dictionarySuggestions: [],
  });
  check('a word with no suggestions says so rather than showing nothing',
    labels(noIdeas)[0], 'No spelling suggestions');

  /* ── a capped list ──────────────────────────────────────────────── */

  const many = build({
    isEditable: true, selectionText: 'x', mediaType: 'none',
    misspelledWord: 'x',
    dictionarySuggestions: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
  });
  check('a dozen suggestions do not bury the commands',
    labels(many).slice(0, 6), ['a', 'b', 'c', 'd', 'e', '—']);

  /* ── saved image names ──────────────────────────────────────────── */

  check('a saved image keeps its own name',
    contextMenu.suggestedName('https://x.test/media/avatars/nadia.jpg'), 'nadia.jpg');
  check('one with no name gets a usable one',
    contextMenu.suggestedName('https://x.test/portal/files/abc/thumb'), 'image.png');
  check('and a data URI does not throw',
    contextMenu.suggestedName('data:image/png;base64,AAAA'), 'image.png');

  console.log(failures ? `\nFAILED (${failures})` : '\nPASSED');
  app.exit(failures ? 1 : 0);
}).catch(err => {
  console.error(err);
  app.exit(2);
});
