/* Illustration theming — swaps illustration art for its dark-mode variant.
   The SVGs are loaded as <img>, so page CSS cannot reach inside them. Instead we
   ship a parallel set under images/illustrations/dark/ where every black fill and
   stroke is white (the blue and red stay as drawn) and point the src at it while
   the dark theme is on. */
(function () {
  'use strict';

  var LIGHT_DIR = 'images/illustrations/';
  var DARK_DIR = 'images/illustrations/dark/';
  var SELECTOR = 'img[src*="images/illustrations/"]';

  function isDark() {
    return !!document.querySelector('[data-theme="dark"]');
  }

  function retarget(img, dark) {
    var src = img.getAttribute('src');
    if (!src || src.indexOf(LIGHT_DIR) === -1) return;
    var onDark = src.indexOf(DARK_DIR) !== -1;
    if (onDark === dark) return;
    img.setAttribute('src', dark ? src.replace(LIGHT_DIR, DARK_DIR) : src.replace(DARK_DIR, LIGHT_DIR));
  }

  function sweep(node, dark) {
    if (!node || node.nodeType !== 1) return;
    if (dark === undefined) dark = isDark();
    if (node.tagName === 'IMG') retarget(node, dark);
    if (!node.querySelectorAll) return;
    var list = node.querySelectorAll(SELECTOR);
    for (var i = 0; i < list.length; i++) retarget(list[i], dark);
  }

  function sweepAll() {
    sweep(document.body || document.documentElement);
  }

  if (typeof MutationObserver === 'function') {
    new MutationObserver(function (records) {
      var dark = isDark();
      for (var i = 0; i < records.length; i++) {
        var rec = records[i];
        if (rec.type === 'attributes') {
          if (rec.attributeName === 'data-theme') { sweepAll(); return; }
          retarget(rec.target, dark);
          continue;
        }
        for (var j = 0; j < rec.addedNodes.length; j++) sweep(rec.addedNodes[j], dark);
      }
    }).observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['src', 'data-theme']
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', sweepAll);
  } else {
    sweepAll();
  }

  window.TMAIllustrations = { refresh: sweepAll, isDark: isDark };
}());
