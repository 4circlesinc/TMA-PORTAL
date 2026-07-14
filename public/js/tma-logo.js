/* tma-portal - TM ANTOINE brand logo */
(function () {
  'use strict';

  const BRAND = {
    name: 'TM ANTOINE Advisory',
    short: 'tma',
    app: 'tma-portal',
    mark: 'images/brand/tma/tma-logo-mark.png',
    horizontal: 'images/brand/tma/tma-logo-horizontal.png',
    favicon: 'images/brand/tma/favicon.png',
  };

  function esc(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function assetPath(file, base) {
    if (!file) return BRAND.mark;
    if (/^https?:\/\//.test(file) || file.startsWith('/')) return file;
    if (base) return `${base.replace(/\/$/, '')}/${file.replace(/^\//, '')}`;
    return file;
  }

  function renderTMALogo(opts) {
    const o = opts || {};
    const href = o.href || '#';
    const cls = o.className || 'tma-logo';
    const variant = o.variant || 'horizontal';
    const base = o.assetBase || '';
    const mark = assetPath(o.mark || BRAND.mark, base);
    const horizontal = assetPath(o.horizontal || BRAND.horizontal, base);
    const tag = o.link === false ? 'div' : 'a';
    const linkAttrs = o.link === false
      ? ''
      : ` href="${esc(href)}" rel="noopener noreferrer"`;

    if (variant === 'mark') {
      const size = o.markSize || o.iconSize || 40;
      return `<${tag} class="${esc(cls)} ${esc(cls)}--mark"${linkAttrs} aria-label="${esc(BRAND.name)}">
        <img class="${esc(cls)}__mark" src="${esc(mark)}" alt="${esc(BRAND.name)}" width="${size}" height="${size}" loading="lazy">
      </${tag}>`;
    }

    if (variant === 'compact') {
      const markSize = o.markSize || o.iconSize || 28;
      const showWordmark = o.wordmark !== false;
      const wordmark = o.wordmarkText || BRAND.name;
      return `<${tag} class="${esc(cls)} ${esc(cls)}--compact"${linkAttrs} aria-label="${esc(BRAND.name)}">
        <img class="${esc(cls)}__mark" src="${esc(mark)}" alt="" width="${markSize}" height="${markSize}" loading="lazy">
        ${showWordmark ? `<span class="${esc(cls)}__wordmark">${esc(wordmark)}</span>` : ''}
      </${tag}>`;
    }

    const height = o.horizontalHeight || 28;
    return `<${tag} class="${esc(cls)} ${esc(cls)}--horizontal"${linkAttrs} aria-label="${esc(BRAND.name)}">
      <img class="${esc(cls)}__horizontal" src="${esc(horizontal)}" alt="${esc(BRAND.name)}" height="${height}" loading="lazy">
    </${tag}>`;
  }

  function renderCoverLogo120(nodeId, opts) {
    const o = opts || {};
    const base = o.assetBase || '../';
    const mark = assetPath(o.mark || BRAND.mark, base);
    return `<div class="ds-cover-tma__logo-wrap" data-node-id="${esc(nodeId || 'tma:brand')}">
      <img class="ds-cover-tma__logo" src="${esc(mark)}" alt="${esc(BRAND.name)}" width="120" height="120" loading="lazy">
    </div>`;
  }

  function renderBrandLogosPanel(opts) {
    const o = opts || {};
    const base = o.assetBase || '../';
    const mark = assetPath(BRAND.mark, base);
    const horizontal = assetPath(BRAND.horizontal, base);
    const favicon = assetPath(BRAND.favicon, base);

    return `<div class="ds-brand-logos" data-node-id="tma:brand-logos">
      <div class="ds-brand-logos__item">
        <div class="ds-brand-logos__preview ds-brand-logos__preview--light">
          <img src="${esc(horizontal)}" alt="" class="ds-brand-logos__horizontal" height="32" loading="lazy">
        </div>
        <p class="ds-brand-logos__label">Horizontal</p>
        <p class="ds-brand-logos__meta">Sidebar expanded · headers</p>
        <code class="ds-brand-logos__path">tma-logo-horizontal.png</code>
      </div>
      <div class="ds-brand-logos__item">
        <div class="ds-brand-logos__preview ds-brand-logos__preview--light">
          <img src="${esc(mark)}" alt="" class="ds-brand-logos__mark" width="40" height="40" loading="lazy">
        </div>
        <p class="ds-brand-logos__label">Mark</p>
        <p class="ds-brand-logos__meta">Sidebar collapsed · cover 120px</p>
        <code class="ds-brand-logos__path">tma-logo-mark.png</code>
      </div>
      <div class="ds-brand-logos__item">
        <div class="ds-brand-logos__preview ds-brand-logos__preview--light">
          <img src="${esc(favicon)}" alt="" class="ds-brand-logos__favicon" width="32" height="32" loading="lazy">
        </div>
        <p class="ds-brand-logos__label">Favicon</p>
        <p class="ds-brand-logos__meta">Browser tab icon</p>
        <code class="ds-brand-logos__path">favicon.png</code>
      </div>
    </div>`;
  }

  function replaceImgLogos(root, opts) {
    if (!root) return;
    const o = opts || {};
    root.querySelectorAll('.tma-logo').forEach((el) => {
      const next = document.createElement('div');
      next.innerHTML = renderTMALogo({
        className: el.className,
        link: el.tagName === 'A',
        href: el.getAttribute('href') || '#',
        variant: o.variant || 'horizontal',
        horizontalHeight: o.horizontalHeight || 28,
        assetBase: o.assetBase,
      });
      const logo = next.firstElementChild;
      if (logo) el.replaceWith(logo);
    });
  }

  window.TMALogo = {
    BRAND,
    assetPath,
    renderTMALogo,
    renderCoverLogo120,
    renderBrandLogosPanel,
    replaceImgLogos,
  };
})();
