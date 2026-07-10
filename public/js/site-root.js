/*
 * GitHub Pages project sites live under /REPO-NAME/.
 * Sets window.__TMA_SITE_ROOT and helpers for URL building.
 */
(function (global) {
  'use strict';

  function detectSiteRoot() {
    if (global.__TMA_SITE_ROOT != null) return global.__TMA_SITE_ROOT;
    if (global.location.hostname.endsWith('github.io')) {
      var seg = global.location.pathname.split('/').filter(Boolean)[0];
      global.__TMA_SITE_ROOT = seg ? '/' + seg : '';
    } else {
      global.__TMA_SITE_ROOT = '';
    }
    return global.__TMA_SITE_ROOT;
  }

  function appUrl(path) {
    var p = String(path == null ? '/' : path);
    if (!p || p === '/') return detectSiteRoot() || '/';
    if (p.charAt(0) !== '/') p = '/' + p;
    return detectSiteRoot() + p;
  }

  detectSiteRoot();
  global.TMASiteRoot = { root: detectSiteRoot, url: appUrl };
})(window);
