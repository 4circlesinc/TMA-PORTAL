/* TMA - Colors documentation card (Figma 30484:266540) */
(function () {
  'use strict';

  const DOC_URL = '#colors';

  const THEMES = ['TMA-Light', 'TMA-Dark', 'iOS-Light', 'iOS-Dark'];

  /* TMA brand - primary pair + 90% white tints */
  const BRAND = {
    primary: '#03a5e9',
    primaryDark: '#136da0',
    tint1: '#e6f6fd',
    tint2: '#e7f0f6',
  };

  const SECONDARY = [
    ['Purple', '#b899eb', '#b899eb', '#af52de', '#bf5af2'],
    ['Indigo', '#adadfb', '#adadfb', '#5856d6', '#5e5ce6'],
    ['Blue', '#7dbbff', '#7dbbff', BRAND.primary, BRAND.primaryDark],
    ['Cyan', '#a0bce8', '#a0bce8', '#32ade6', '#64d2ff'],
    ['Mint', '#6be6d3', '#6be6d3', '#00c7be', '#63e6e2'],
    ['Green', '#71dd8c', '#71dd8c', '#34c759', '#30d158'],
    ['Yellow', '#ffcc00', '#ffcc00', '#ffcc00', '#ffd60a'],
    ['Orange', '#ffb55b', '#ffb55b', '#ff9500', '#ff9f0a'],
    ['Red', '#ff4747', '#ff4747', '#ff3b30', '#ff453a'],
  ];

  function esc(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function textColor(bg) {
    if (bg === '#ffffff' || bg.indexOf('rgba(255,255,255') === 0) return '#000000';
    if (bg === '#000000' || bg.indexOf('rgba(0,0,0') === 0) return '#ffffff';
    const hex = bg.replace('#', '');
    if (hex.length !== 6) return '#000000';
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return (r * 0.299 + g * 0.587 + b * 0.114) > 160 ? '#000000' : '#ffffff';
  }

  function swatch(label, bg, opts) {
    const o = opts || {};
    const fg = o.fg || textColor(bg.startsWith('#') ? bg : '#000000');
    const borderStyle = o.border ? 'border:1px solid #ffffff;' : (o.lightBorder ? 'border:1px solid rgba(0,0,0,0.1);' : '');
    return `<div class="ds-color-swatch" style="background:${esc(bg)};color:${esc(fg)};${borderStyle}">${esc(label)}</div>`;
  }

  function themeHeader(name, active) {
    return `<div class="ds-color-theme${active ? ' ds-color-theme--active' : ''}">
      <span class="ds-color-theme__radio" aria-hidden="true"></span>
      <span class="ds-color-theme__name">${esc(name)}</span>
    </div>`;
  }

  function themeColumn(index, name) {
    /* TMA brand primaries + derived tints */
    const primarySets = [
      [
        { l: 'Primary', bg: BRAND.primaryDark },
        { l: 'Color 1', bg: BRAND.tint1 },
        { l: 'Color 2', bg: BRAND.tint2 },
      ],
      [
        { l: 'Primary', bg: BRAND.primary },
        { l: 'Color 1', bg: BRAND.tint1 },
        { l: 'Color 2', bg: BRAND.tint2 },
      ],
      [
        { l: 'Primary', bg: BRAND.primary },
        { l: 'Color 1', bg: BRAND.tint1 },
        { l: 'Color 2', bg: BRAND.tint2 },
      ],
      [
        { l: 'Primary', bg: BRAND.primaryDark },
        { l: 'Color 1', bg: BRAND.tint1 },
        { l: 'Color 2', bg: BRAND.tint2 },
      ],
    ];
    const blackSets = [
      ['Black 100%', '#000000'], ['Black 80%', 'rgba(0,0,0,0.8)'], ['Black 40%', 'rgba(0,0,0,0.4)'],
      ['Black 20%', 'rgba(0,0,0,0.2)'], ['Black 10%', 'rgba(0,0,0,0.1)'], ['Black 5%', 'rgba(0,0,0,0.05)'],
    ];
    const whiteSets = [
      ['White 100%', '#ffffff'], ['White 80%', 'rgba(255,255,255,0.8)'], ['White 40%', 'rgba(255,255,255,0.4)'],
      ['White 20%', 'rgba(255,255,255,0.2)'], ['White 10%', 'rgba(255,255,255,0.1)'], ['White 5%', 'rgba(255,255,255,0.05)'],
    ];
    const bgSets = [
      ['Background 1', '#ffffff'], ['Background 2', '#f9f9fa'], ['Background 3', '#f5f5f6'],
    ];
    const surfaceSets = [
      ['Surface 1', '#ffffff'], ['Surface 2', '#f9f9fa'], ['Surface 3', '#f5f5f6'],
    ];

    if (index === 1) {
      blackSets.splice(0, 6, ['White 100%', '#ffffff'], ['White 80%', 'rgba(255,255,255,0.8)'], ['White 40%', 'rgba(255,255,255,0.4)'], ['White 20%', 'rgba(255,255,255,0.2)'], ['White 15%', 'rgba(255,255,255,0.15)'], ['White 10%', 'rgba(255,255,255,0.1)']);
      whiteSets.splice(0, 6, ['Black 100%', '#000000'], ['Black 80%', 'rgba(0,0,0,0.8)'], ['Black 40%', 'rgba(0,0,0,0.4)'], ['Black 20%', 'rgba(0,0,0,0.2)'], ['Black 10%', 'rgba(0,0,0,0.1)'], ['Black 5%', 'rgba(0,0,0,0.05)']);
      bgSets.splice(0, 3, ['Background 1', '#1c1c1e'], ['Background 2', '#2c2c2e'], ['Background 3', '#3a3a3c']);
      surfaceSets.splice(0, 3, ['Surface 1', '#2c2c2e'], ['Surface 2', '#3a3a3c'], ['Surface 3', '#48484a']);
    }
    if (index >= 2) {
      bgSets[0] = ['Background 1', '#f5f5f6'];
      surfaceSets[0] = ['Surface 1', '#ffffff'];
    }
    if (index === 3) {
      bgSets.splice(0, 3, ['Background 1', '#000000'], ['Background 2', '#1c1c1e'], ['Background 3', '#2c2c2e']);
      surfaceSets.splice(0, 3, ['Surface 1', '#1c1c1e'], ['Surface 2', '#2c2c2e'], ['Surface 3', '#3a3a3c']);
    }

    const secondary = SECONDARY.map((row) => swatch(row[0], row[index + 1]));

    return `<div class="ds-color-col">
      ${themeHeader(name, index === 0)}
      <div class="ds-color-stack">${primarySets[index].map(function (s) {
        return swatch(s.l, s.bg, { border: s.border, lightBorder: s.l !== 'Primary' && s.bg === '#ffffff' });
      }).join('')}</div>
      <div class="ds-color-stack">${blackSets.map(function (s) {
        return swatch(s[0], s[1], { lightBorder: s[1] === '#ffffff', fg: s[1] === '#ffffff' ? '#000' : undefined });
      }).join('')}</div>
      <div class="ds-color-stack">${whiteSets.map(function (s) {
        return swatch(s[0], s[1], { lightBorder: s[1] === '#ffffff', fg: s[1] === '#ffffff' ? '#000' : undefined });
      }).join('')}</div>
      <div class="ds-color-stack">${secondary.join('')}</div>
      <div class="ds-color-stack">${bgSets.map(function (s) {
        return swatch(s[0], s[1], { lightBorder: s[1] === '#ffffff', fg: s[1] === '#ffffff' ? '#000' : undefined });
      }).join('')}</div>
      <div class="ds-color-stack">${surfaceSets.map(function (s) {
        return swatch(s[0], s[1], { lightBorder: s[1] === '#ffffff', fg: s[1] === '#ffffff' ? '#000' : undefined });
      }).join('')}</div>
    </div>`;
  }

  function renderColorsCard(opts) {
    const o = opts || {};
    const logo = window.TMALogo
      ? window.TMALogo.renderTMALogo({ link: false, assetBase: o.assetBase, horizontalHeight: 28 })
      : '';
    return `<section class="dr-doc ds-colors-card" data-node-id="30484:266540" id="section-colors">
      <header class="dr-doc__header">
        <div class="dr-doc__header-left">
          <h2 class="dr-doc__title">Colors</h2>
          <div class="dr-doc__subtitle">
            <a href="${esc(DOC_URL)}" target="_blank" rel="noopener noreferrer">tma-portal/colors ↗</a>
          </div>
        </div>
        ${logo}
      </header>
      <div class="dr-doc__body">
        <div class="dr-row">
          <div class="dr-row__label dr-row__label--accent">Introduction</div>
          <div class="dr-row__content"><div class="dr-row__text">
            <p>Colors are a key part of the design system.</p>
            <p>To define Colors, we have the following principles: 1. Widely used in design. 2. The number of Colors should be as small as possible.</p>
            <p>Themes variables change between light and dark modes, while Color styles remain unchanged.</p>
          </div></div>
        </div>
        <div class="dr-row">
          <div class="dr-row__label dr-row__label--accent">Rules of use</div>
          <div class="dr-row__content"><div class="dr-row__text">
            <p>Please try to keep the number of Colors below 32.</p>
            <p>90% principle: If the Colors used in a single product accounts for less than 10%, please do not include it in the design system.</p>
          </div></div>
        </div>
        <div class="dr-row dr-row--dark-sep dr-row--pb-lg">
          <div class="dr-row__label dr-row__label--accent">How to use</div>
          <div class="dr-row__content"><p class="dr-row__text">Colors can be added, modified and deleted. Modifying them will affect all components and pages, please proceed with caution.</p></div>
        </div>
        <div class="ds-color-grid">
          <div class="ds-color-grid__labels">
            <div class="ds-color-grid__spacer"></div>
            <div class="ds-color-grid__label">Primary</div>
            <div class="ds-color-grid__label">Black</div>
            <div class="ds-color-grid__label">White</div>
            <div class="ds-color-grid__label">secondary</div>
            <div class="ds-color-grid__label">Background</div>
            <div class="ds-color-grid__label">Surface</div>
          </div>
          <div class="ds-color-grid__themes">
            ${THEMES.map((name, i) => themeColumn(i, name)).join('')}
          </div>
        </div>
      </div>
    </section>`;
  }

  window.TMADesignSystemColors = { renderColorsCard };
})();
