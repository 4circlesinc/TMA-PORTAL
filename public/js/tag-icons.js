/* TMA - Tag inline SVG icons */
(function () {
  'use strict';

  const ICONS = {
    Close12: {
      viewBox: '0 0 5.523 5.523',
      inner: '<path d="M0.640165 0.109835C0.493718 -0.0366117 0.256282 -0.0366117 0.109835 0.109835C-0.0366117 0.256282 -0.0366117 0.493718 0.109835 0.640165L2.23117 2.7615L0.109863 4.88281C-0.0365833 5.02925 -0.0365835 5.26669 0.109863 5.41314C0.25631 5.55958 0.493747 5.55958 0.640193 5.41314L2.7615 3.29183L4.88281 5.41314C5.02925 5.55958 5.26669 5.55958 5.41314 5.41314C5.55958 5.26669 5.55958 5.02925 5.41314 4.88281L3.29183 2.7615L5.41316 0.640166C5.55961 0.493719 5.55961 0.256282 5.41316 0.109836C5.26672 -0.0366111 5.02928 -0.0366111 4.88283 0.109835L2.7615 2.23117L0.640165 0.109835Z" fill="currentColor" fill-opacity="0.4"/>',
    },
  };

  function svg(key, cls, w, h) {
    const icon = ICONS[key];
    if (!icon) return '';
    const width = w != null ? w : 12;
    const height = h != null ? h : width;
    const classAttr = cls ? ` class="${cls}"` : '';
    return `<svg${classAttr} width="${width}" height="${height}" viewBox="${icon.viewBox}" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${icon.inner}</svg>`;
  }

  window.TMATagIcons = { svg, ICONS };
})();
