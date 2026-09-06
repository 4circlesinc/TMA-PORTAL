/**
 * Links inside a mail you opened in the portal.
 *
 * The body lives in a sandboxed iframe, so a click would otherwise replace
 * the message. In a browser the iframe itself opens a new tab (target=_blank
 * plus allow-popups). In the desktop app that would spawn another Electron
 * window, so those clicks are sent to the system browser instead.
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

  function onDocClick(event) {
    if (!event) return;
    var t = event.target;
    if (!t || typeof t.closest !== 'function') return;
    var a = t.closest('a[href], area[href]');
    if (!a) return;
    var href = a.getAttribute('href');
    if (!href || href.trim().charAt(0) === '#') return;
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
    wireFrame: wireFrame,
  };
})(window);
