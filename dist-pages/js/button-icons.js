/* TMA - Button inline SVG icons (Figma DefaultIcon placeholder) */
(function () {
  'use strict';

  const ICONS = {
    DefaultIcon12Light: {
      viewBox: '0 0 12 12',
      inner: '<rect x="0.25" y="0.25" width="11.5" height="11.5" rx="1" fill="rgba(0,0,0,0.04)" stroke="rgba(0,0,0,0.8)" stroke-width="0.5" stroke-dasharray="1 1"/>',
    },
    DefaultIcon16Light: {
      viewBox: '0 0 16 16',
      inner: '<rect x="0.25" y="0.25" width="15.5" height="15.5" rx="1.33" fill="rgba(0,0,0,0.04)" stroke="rgba(0,0,0,0.8)" stroke-width="0.5" stroke-dasharray="1 1"/>',
    },
    DefaultIcon12Dark: {
      viewBox: '0 0 12 12',
      inner: '<rect x="0.25" y="0.25" width="11.5" height="11.5" rx="1" fill="rgba(255,255,255,0.1)" stroke="rgba(255,255,255,0.6)" stroke-width="0.5" stroke-dasharray="1 1"/>',
    },
    DefaultIcon16Dark: {
      viewBox: '0 0 16 16',
      inner: '<rect x="0.25" y="0.25" width="15.5" height="15.5" rx="1.33" fill="rgba(255,255,255,0.1)" stroke="rgba(255,255,255,0.6)" stroke-width="0.5" stroke-dasharray="1 1"/>',
    },
  };

  function svg(key, className, width, height) {
    const icon = ICONS[key];
    if (!icon) return '';
    const cls = className ? ` class="${className}"` : '';
    return `<svg${cls} width="${width}" height="${height}" viewBox="${icon.viewBox}" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${icon.inner}</svg>`;
  }

  window.TMAButtonIcons = { svg };
})();
