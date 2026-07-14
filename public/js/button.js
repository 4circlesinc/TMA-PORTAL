/* TMA - Button component (Figma 33311:3641 component set) */
(function () {
  'use strict';

  const svg = (key, cls, w, h) => (window.TMAButtonIcons && window.TMAButtonIcons.svg(key, cls, w, h)) || '';

  const SIZES = {
    small: { iconText: 12, iconOnly: 16, label: 'Button' },
    medium: { iconText: 14, iconOnly: 20, label: 'Button' },
    large: { iconText: 16, iconOnly: 24, label: 'Button' },
    xlarge: { iconText: 20, iconOnly: 28, label: 'Button' },
  };

  const VARIANTS = ['borderless', 'grey', 'outline', 'filled'];
  const VARIANT_LABELS = {
    borderless: 'Borderless',
    grey: 'Grey',
    outline: 'Outline',
    filled: 'Filled',
  };
  const SIZE_LABELS = {
    small: 'Small',
    medium: 'Medium',
    large: 'Large',
    xlarge: 'XLarge',
  };
  const STATES = ['default', 'hover'];

  function esc(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function iconKey(size, variant, layout) {
    const spec = SIZES[size] || SIZES.small;
    const px = layout === 'icon' ? spec.iconOnly : spec.iconText;
    const tone = variant === 'filled' ? 'Dark' : 'Light';
    return px <= 12 ? `DefaultIcon12${tone}` : `DefaultIcon16${tone}`;
  }

  function iconSize(size, layout) {
    const spec = SIZES[size] || SIZES.small;
    return layout === 'icon' ? spec.iconOnly : spec.iconText;
  }

  function renderIcon(size, variant, layout) {
    const px = iconSize(size, layout);
    const key = iconKey(size, variant, layout);
    const cls = 'tma-button__icon-svg';
    if (px <= 12) return svg(key, cls, 12, 12);
    if (px <= 16) return svg(key, cls, 16, 16);
    if (px <= 20) return svg(key, cls, 20, 20);
    if (px <= 24) return svg(key, cls, 24, 24);
    return svg(key, cls, 28, 28);
  }

  function renderButton(opts) {
    const o = opts || {};
    const size = o.size || 'small';
    const variant = o.variant || 'borderless';
    const state = o.state || 'default';
    const layout = o.layout || 'leading';
    const shape = o.shape || 'rect';
    const label = o.label != null ? o.label : (SIZES[size] || SIZES.small).label;
    const nodeId = o.nodeId || '';
    const nodeAttr = nodeId ? ` data-node-id="${esc(nodeId)}"` : '';
    const interactive = o.interactive !== false;
    const stateClass = state === 'hover' ? ' tma-button--state-hover' : '';
    const shapeClass = shape === 'circle' ? ' tma-button--circle' : '';
    const layoutClass = ` tma-button--layout-${esc(layout)}`;
    const tabAttr = interactive ? '' : ' tabindex="-1"';

    const showLeft = layout === 'leading' || layout === 'icon';
    const showRight = layout === 'trailing';
    const showLabel = layout !== 'icon';

    const leftIcon = showLeft
      ? `<span class="tma-button__icon">${renderIcon(size, variant, layout)}</span>`
      : '';
    const rightIcon = showRight
      ? `<span class="tma-button__icon tma-button__icon--trailing">${renderIcon(size, variant, layout)}</span>`
      : '';
    const labelHtml = showLabel
      ? `<span class="tma-button__label">${esc(label)}</span>`
      : '';

    return `<button type="button" class="tma-button tma-button--${esc(size)} tma-button--${esc(variant)}${layoutClass}${shapeClass}${stateClass}"${nodeAttr}${tabAttr}${interactive ? '' : ' aria-hidden="true"'}>
      ${leftIcon}
      ${labelHtml}
      ${rightIcon}
    </button>`;
  }

  function renderVariantCluster(opts) {
    const o = opts || {};
    const layouts = o.layouts || ['leading', 'trailing', 'text'];
    const variant = o.variant || 'borderless';
    return `<div class="tma-button-set__variant-cluster"${o.nodeId ? ` data-node-id="${esc(o.nodeId)}"` : ''}>
      <div class="tma-button-set__variant-buttons">
      ${layouts.map((layout) => renderButton({
        size: o.size,
        variant,
        state: o.state,
        layout,
        interactive: o.interactive,
      })).join('')}
      </div>
      ${o.showLabel ? `<span class="tma-button-set__variant-label">${esc(VARIANT_LABELS[variant] || variant)}</span>` : ''}
    </div>`;
  }

  function renderIconOnlyPair(opts) {
    const o = opts || {};
    const variant = o.variant || 'borderless';
    return `<div class="tma-button-set__icon-only"${o.nodeId ? ` data-node-id="${esc(o.nodeId)}"` : ''}>
      <div class="tma-button-set__icon-only-buttons">
      ${renderButton({ size: o.size, variant, state: o.state, layout: 'icon', shape: 'rect', interactive: o.interactive })}
      ${renderButton({ size: o.size, variant, state: o.state, layout: 'icon', shape: 'circle', interactive: o.interactive })}
      </div>
      ${o.showLabel ? `<span class="tma-button-set__variant-label">${esc(VARIANT_LABELS[variant] || variant)}</span>` : ''}
    </div>`;
  }

  function renderSizeGroup(opts) {
    const o = opts || {};
    const size = o.size || 'small';
    const state = o.state || 'default';
    const variantsHtml = VARIANTS.map((variant) => renderVariantCluster({
      size,
      variant,
      state,
      interactive: o.interactive,
      showLabel: o.showLabels,
    })).join('');
    const iconOnlyHtml = VARIANTS.map((variant) => renderIconOnlyPair({
      size,
      variant,
      state,
      interactive: o.interactive,
      showLabel: o.showLabels,
    })).join('');

    const sizeLabel = o.showLabels
      ? `<span class="tma-button-set__size-label">${esc(SIZE_LABELS[size] || size)}</span>`
      : '';

    return `<div class="tma-button-set__size-group tma-button-set__size-group--${esc(size)}"${o.nodeId ? ` data-node-id="${esc(o.nodeId)}"` : ''}>
      ${sizeLabel}
      <div class="tma-button-set__size-body">
        <div class="tma-button-set__size-variants">${variantsHtml}</div>
        <div class="tma-button-set__size-icons">${iconOnlyHtml}</div>
      </div>
    </div>`;
  }

  function renderStateRow(opts) {
    const o = opts || {};
    const state = o.state || 'default';
    const sizes = o.sizes || Object.keys(SIZES);
    const label = state === 'hover' ? 'Hover' : 'Default';

    return `<section class="tma-button-set__state-row tma-button-set__state-row--${esc(state)}"${o.nodeId ? ` data-node-id="${esc(o.nodeId)}"` : ''}>
      <span class="tma-button-set__state-label">${label}</span>
      <div class="tma-button-set__state-grid">
        ${sizes.map((size) => renderSizeGroup({ size, state, interactive: o.interactive, showLabels: o.showLabels })).join('')}
      </div>
    </section>`;
  }

  function renderComponentSet(opts) {
    const o = opts || {};
    const nodeId = o.nodeId || '33311:3641';
    const interactive = o.interactive === true;
    return `<div class="tma-button-set"${nodeId ? ` data-node-id="${esc(nodeId)}"` : ''}>
      <svg class="tma-button-set__dash-border" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 3760 512" preserveAspectRatio="none">
        <rect x="1" y="1" width="3758" height="510" rx="20" ry="20"/>
      </svg>
      ${renderStateRow({ state: 'default', interactive, showLabels: false })}
      ${renderStateRow({ state: 'hover', interactive, showLabels: true })}
    </div>`;
  }

  function mountComponentSet(el, opts) {
    if (!el) return;
    el.innerHTML = renderComponentSet(opts || {});
  }

  window.TMAButton = {
    SIZES,
    VARIANTS,
    VARIANT_LABELS,
    SIZE_LABELS,
    STATES,
    renderButton,
    renderVariantCluster,
    renderIconOnlyPair,
    renderSizeGroup,
    renderStateRow,
    renderComponentSet,
    mountComponentSet,
  };
})();
