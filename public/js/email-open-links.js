/**
 * Links inside a mail you opened in the portal.
 *
 * A link back into the portal (the portal's own notification mail) opens
 * in place, in this window, without a reload; see openInPortal().
 *
 * Every other link: the body lives in a sandboxed iframe, so a click would
 * otherwise replace the message. In a browser the iframe itself opens a new
 * tab (target=_blank plus allow-popups). In the desktop app that would spawn
 * another Electron window, so those clicks are sent to the system browser
 * instead.
 */
(function (root) {
  'use strict';

  function resolveHref(href, base) {
    if (typeof href !== 'string') return '';
    href = href.trim();
    if (!href || href.charAt(0) === '#') return '';
    var origin = base;
    if (!origin && root && root.location && root.location.href) {
      origin = root.location.href;
    }
    if (!origin) origin = 'https://invalid.invalid';
    try {
      return new URL(href, origin).href;
    } catch (e) {
      return '';
    }
  }

  function isOpenable(url) {
    if (!url) return false;
    try {
      var protocol = new URL(url).protocol.toLowerCase();
      return protocol === 'http:' || protocol === 'https:'
        || protocol === 'mailto:' || protocol === 'tel:';
    } catch (e) {
      return false;
    }
  }

  function isDesktopBrowser() {
    var desktop = root && root.TMADesktop;
    return !!(desktop && typeof desktop.openInBrowser === 'function');
  }

  function openInSystemBrowser(href) {
    var url = resolveHref(href);
    if (!isOpenable(url)) return false;
    root.TMADesktop.openInBrowser(url);
    return true;
  }

  function rewriteDocument(doc) {
    if (!doc) return;
    var nodes = doc.querySelectorAll('a[href], area[href]');
    for (var i = 0; i < nodes.length; i++) {
      var a = nodes[i];
      var href = (a.getAttribute('href') || '').trim();
      if (!href || href.charAt(0) === '#') continue;
      var url = resolveHref(href);
      if (!isOpenable(url)) {
        a.removeAttribute('href');
        continue;
      }
      a.setAttribute('href', url);
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener noreferrer');
    }
  }

  /*
   * Outlook's Safe Links wraps every link in a mail the firm receives:
   * https://eur01.safelinks.protection.outlook.com/?url=<the real one>&...
   * The portal's own "Open the application" button arrives that way, so it
   * is unwrapped before asking whether it points back into the portal.
   */
  function unwrapSafeLink(url) {
    try {
      var u = new URL(url);
      if (/(^|\.)safelinks\.protection\.outlook\.com$/i.test(u.hostname)) {
        var inner = u.searchParams.get('url');
        if (inner) return inner;
      }
    } catch (e) { /* not a URL we can read; leave it */ }
    return url;
  }

  function samePortal(u) {
    var here = root && root.location;
    if (!here || !here.hostname) return false;
    if (u.origin === here.origin) return true;
    // www. and the bare domain are the same portal.
    return u.protocol === here.protocol
      && (u.port || '') === (here.port || '')
      && u.hostname.replace(/^www\./i, '').toLowerCase()
        === here.hostname.replace(/^www\./i, '').toLowerCase();
  }

  /* The portal path a link points at ("/citizenship-applications/x?tab=y"), or null. */
  function portalPath(href) {
    var url = unwrapSafeLink(resolveHref(href));
    if (!url) return null;
    var u;
    try { u = new URL(url); } catch (e) { return null; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (!samePortal(u)) return null;
    return u.pathname + u.search;
  }

  /*
   * The page shell that can open a portal path in place: this window's, or
   * — in a mail popped out into its own window — the portal window that
   * opened it.
   */
  function portalShell() {
    var doc = root && root.document;
    var dash = doc && doc.querySelector('.tma-dash');
    if (dash && typeof dash._portalNavigate === 'function') return { dash: dash, win: root };

    try {
      var opener = root.opener;
      if (opener && !opener.closed && opener.document) {
        var other = opener.document.querySelector('.tma-dash');
        if (other && typeof other._portalNavigate === 'function') return { dash: other, win: opener };
      }
    } catch (e) { /* an opener on another origin cannot be reached */ }

    return null;
  }

  /*
   * A link back into the portal opens in the portal.
   *
   * The portal's own mail ("Open the application", "Review the request")
   * links to a page of the portal. Read in the portal's Email, that link
   * opened a second browser tab — or, in the desktop app, the system
   * browser — and loaded the whole portal again to show a page this window
   * could have drawn. Now the shell opens it in place, the way a
   * notification does: no new tab, no reload. Anything the shell cannot
   * draw (a download, the sign-in page) goes on opening the way it did.
   */
  function openInPortal(href) {
    var path = portalPath(href);
    if (!path) return false;
    var shell = portalShell();
    if (!shell) return false;

    var handled = false;
    try {
      handled = shell.dash._portalNavigate(path, { inPlaceOnly: true }) === true;
    } catch (e) {
      handled = false;
    }
    if (handled && shell.win !== root) {
      try { shell.win.focus(); } catch (e) { /* focus is a courtesy */ }
    }

    return handled;
  }

  function onDocClick(event) {
    if (!event) return;
    var t = event.target;
    if (!t || typeof t.closest !== 'function') return;
    var a = t.closest('a[href], area[href]');
    if (!a) return;
    var href = a.getAttribute('href');
    if (!href || href.trim().charAt(0) === '#') return;

    // A plain click on a portal link opens in place. Cmd/Ctrl/Shift-click
    // keeps meaning "somewhere else", as it does everywhere.
    var modified = event.metaKey || event.ctrlKey || event.shiftKey || event.altKey ||
      (typeof event.button === 'number' && event.button !== 0);
    if (!modified && openInPortal(href)) {
      event.preventDefault();
      if (event.stopPropagation) event.stopPropagation();
      return;
    }

    if (!isDesktopBrowser()) return;
    event.preventDefault();
    if (event.stopPropagation) event.stopPropagation();
    openInSystemBrowser(href);
  }

  function wireFrame(frame) {
    if (!frame) return;
    var doc;
    try { doc = frame.contentDocument; } catch (e) { return; }
    if (!doc || !doc.documentElement) return;
    rewriteDocument(doc);
    if (doc.documentElement.getAttribute('data-email-links-wired') === '1') return;
    doc.documentElement.setAttribute('data-email-links-wired', '1');
    doc.addEventListener('click', onDocClick, true);
  }

  root.TMAEmailOpenLinks = {
    resolveHref: resolveHref,
    isOpenable: isOpenable,
    portalPath: portalPath,
    wireFrame: wireFrame,
  };
})(window);
