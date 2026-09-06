/**
 * Clicks inside a sandboxed email body: open the destination outside the
 * message frame. The desktop app uses the system browser; a regular browser
 * uses a new tab. Hash-only jumps stay inside the frame.
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

  function open(href, base) {
    var url = resolveHref(href, base);
    if (!isOpenable(url)) return false;
    var desktop = root && root.TMADesktop;
    if (desktop && typeof desktop.openInBrowser === 'function') {
      desktop.openInBrowser(url);
      return true;
    }
    if (root && typeof root.open === 'function') {
      root.open(url, '_blank', 'noopener,noreferrer');
    }
    return true;
  }

  function onDocClick(event) {
    if (!event || event.defaultPrevented) return;
    var t = event.target;
    if (!t || typeof t.closest !== 'function') return;
    var a = t.closest('a[href], area[href]');
    if (!a) return;
    var href = a.getAttribute('href');
    if (!href || href.trim().charAt(0) === '#') return;
    event.preventDefault();
    if (event.stopPropagation) event.stopPropagation();
    open(href);
  }

  function wireFrame(frame) {
    if (!frame) return;
    var doc;
    try { doc = frame.contentDocument; } catch (e) { return; }
    if (!doc || !doc.documentElement) return;
    if (doc.documentElement.getAttribute('data-email-links-wired') === '1') return;
    doc.documentElement.setAttribute('data-email-links-wired', '1');
    doc.addEventListener('click', onDocClick, true);
  }

  root.TMAEmailOpenLinks = {
    resolveHref: resolveHref,
    isOpenable: isOpenable,
    open: open,
    wireFrame: wireFrame,
  };
})(window);
