/*
 * Casual-copy friction for accounts that are not administrators.
 *
 * Emitted by App\Support\PortalShell::bootScript() in the SPA and by
 * partials/ui-lockdown.blade.php on standalone pages, only for a reader
 * that Role::isAdmin() refuses, so a developer signed in as an administrator
 * gets an unmodified page with the browser's own menus intact.
 *
 * What this is, honestly: friction, not protection. Every byte it guards has
 * already been delivered to the browser, or the page could not show it. The
 * network panel, view-source and the built bundle under /build are all still
 * right there. It stops a reader dragging a photo onto their desktop and it
 * stops "Save image as"; it stops nobody who opens devtools. The controls
 * that actually protect a file are on the server: FileAccess::authorize on
 * every byte route, the share-link tokens, and the envelope encryption.
 *
 * Two rules keep it from breaking the portal:
 *
 *   1. The portal's own right-click menus must still work. The file manager,
 *      messages, folders, CBI, users and shortcuts all raise their own menu
 *      from a contextmenu handler and call preventDefault() without calling
 *      stopPropagation(). Both listeners here are bubble-phase and bound on
 *      document, so they run last, after any of those. If the event comes
 *      back already defaultPrevented, the portal has handled it and this does
 *      nothing at all.
 *
 *   2. Drag-to-move must still work. File rows and folder cards carry
 *      draggable="true" on purpose (see portal-files.js), and dragging one
 *      onto a folder is how a file is moved. Only images are blocked here,
 *      and only when the drag did not start inside such a row.
 */
(function () {
  'use strict';

  if (window.__tmaUiLockdown) return;
  window.__tmaUiLockdown = true;

  /* The stylesheet half (long-press callout, image selection) hangs off this
   * class rather than applying to every page, because the overrides file is
   * served to administrators too. Set on <html>, which exists now: this runs
   * in <head>, so there is no <body> to mark yet and nothing has painted. */
  document.documentElement.classList.add('tma-locked');

  /* Elements whose own drag IS a feature; a drag starting inside one is the
   * portal's, not an attempt to pull a picture out of the page. */
  var DRAGGABLE_UI = [
    '[data-files-row]',
    '[data-clients-row]',
    '[data-cbi-row]',
    '[data-shortcut-row]',
    '[draggable="true"]'
  ].join(',');

  /* Where a native menu is worth more than the friction: a reader still needs
   * spellcheck and paste in a field they are typing in, and copy on text they
   * have selected. Blocking those reads as a broken page, not a locked one.
   * Auth pages (.tma-auth) always keep the native menu — including blank space
   * around fields — so Paste on sign-in is never the casualty, even though
   * partials/ui-lockdown.blade.php loads this script there for image friction. */
  function wantsNativeMenu(target) {
    if (document.querySelector('.tma-auth')) return true;
    if (!target || !target.closest) return false;
    if (target.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]')) return true;

    return String(window.getSelection() || '') !== '';
  }

  document.addEventListener('dragstart', function (e) {
    if (e.defaultPrevented) return;

    var target = e.target;
    if (!target || !target.closest) return;
    if (target.closest(DRAGGABLE_UI)) return;

    var img = target.closest('img, picture, svg, [data-tma-thumb], [style*="background-image"]');
    if (!img) return;

    e.preventDefault();
  });

  document.addEventListener('contextmenu', function (e) {
    /* The portal raised its own menu for this click. Leave it alone. */
    if (e.defaultPrevented) return;
    if (wantsNativeMenu(e.target)) return;

    e.preventDefault();
  });
}());
