/* TMA - Design system board (Figma 15098:130290) */
(function () {
  'use strict';

  const BOARD = { w: 13980, h: 3012, nodeId: '15098:130290', gap: 100 };
  const DOC_URL = '#';
  const ASSET_BASE = '../';

  const CARDS = [
    { key: 'tma', nodeId: '30484:266531', x: 0, y: 0, w: 1000, h: 1200, type: 'cover-snow' },
    { key: 'principle', nodeId: '30484:266533', x: 1100, y: 0, w: 1000, h: 1200, type: 'section', sectionId: 'section-principle' },
    { key: 'contents', nodeId: '30484:266532', x: 2200, y: 0, w: 1000, h: 1200, type: 'section', sectionId: 'section-contents' },
    { key: 'variables', nodeId: '30484:266534', x: 3300, y: 0, w: 1440, h: 1500, type: 'section', sectionId: 'section-variables' },
    { key: 'spacing', nodeId: '30484:266539', x: 4840, y: 0, w: 1440, h: 1180, type: 'section', sectionId: 'section-spacing' },
    { key: 'colors', nodeId: '30484:266540', x: 6380, y: 0, w: 1440, h: 3012, type: 'colors' },
    { key: 'text', nodeId: '30484:266537', x: 7920, y: 0, w: 1440, h: 2084, type: 'section', sectionId: 'section-text' },
    { key: 'effects', nodeId: '30484:266538', x: 9460, y: 0, w: 1440, h: 1340, type: 'section', sectionId: 'section-effects' },
    { key: 'components', nodeId: '30484:266535', x: 11000, y: 0, w: 1440, h: 1516, type: 'section', sectionId: 'section-components' },
    { key: 'resources', nodeId: '30484:266536', x: 12540, y: 0, w: 1440, h: 1272, type: 'section', sectionId: 'section-resources' },
  ];

  function esc(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderFooter() {
    const logo = window.TMALogo.renderTMALogo({
      link: false,
      assetBase: ASSET_BASE,
      horizontalHeight: 24,
    });
    const logoLight = window.TMALogo.renderTMALogo({
      link: false,
      assetBase: ASSET_BASE,
      horizontalHeight: 28,
    });
    return { dark: logo, light: logoLight };
  }

  function renderTMACover() {
    const footers = renderFooter();
    return `<section class="ds-cover-tma dr-cover" data-node-id="30484:266531" id="section-tma">
      <div class="ds-cover-tma__body">
        ${window.TMALogo.renderCoverLogo120('32792:3420', { assetBase: ASSET_BASE })}
        <div class="ds-cover-tma__hero">
          <p class="ds-cover-tma__line ds-cover-tma__line--brand">tma</p>
          <p class="ds-cover-tma__line ds-cover-tma__line--upper">DESIGN</p>
          <p class="ds-cover-tma__line ds-cover-tma__line--upper">SYSTEM</p>
        </div>
        <div class="ds-cover-tma__copy">
          <p>TM ANTOINE brand logos, tokens, and UI patterns for tma-portal.</p>
          <p>Horizontal logo, mark, and favicon live in <code>images/brand/tma/</code>; third-party marks in <code>images/icons/brands/</code>.</p>
        </div>
      </div>
      <footer class="dr-cover__footer ds-cover-tma__footer">
        ${footers.dark}
        <a class="dr-cover__footer-link ds-cover-tma__footer-link" href="${esc(DOC_URL)}" target="_blank" rel="noopener noreferrer">tma-portal</a>
      </footer>
    </section>`;
  }

  function patchPrincipleSection(section) {
    if (!section) return;
    const img = section.querySelector('.dr-principle-graphic');
    if (img) {
      const title = document.createElement('p');
      title.className = 'ds-principle-title';
      title.textContent = '90% PRINCIPLE';
      img.replaceWith(title);
    }
  }

  function patchResourcesLogos(section) {
    if (!section || !window.TMALogo) return;
    section.querySelectorAll('.dr-row').forEach(function (row) {
      var label = row.querySelector('.dr-row__label');
      if (!label || label.textContent.trim() !== 'Logos') return;
      var content = row.querySelector('.dr-row__content');
      if (!content) return;
      content.innerHTML =
        '<div class="dr-row__text">' +
          '<p><strong>TM ANTOINE brand</strong> - official horizontal logo, circular mark, and favicon. Use <code>TMALogo.renderTMALogo()</code> with <code>variant: &quot;horizontal&quot;</code> or <code>&quot;mark&quot;</code>.</p>' +
          '<p><strong>Third-party marks</strong> - 24×24 and 40×40 SVG brand icons for buttons, frames, and task rows. Browse <a href="brand-logos.html">brand-logos.html ↗</a>.</p>' +
        '</div>' +
        window.TMALogo.renderBrandLogosPanel({ assetBase: ASSET_BASE });
    });
  }

  function prepareSection(section, cardKey) {
    if (!section) return null;
    const clone = section.cloneNode(true);
    clone.removeAttribute('id');
    clone.classList.add('ds-board-card__inner');
    if (clone.querySelector('.dr-principle-graphic')) {
      patchPrincipleSection(clone);
    }
    if (cardKey === 'resources') {
      patchResourcesLogos(clone);
    }
    window.TMALogo.replaceImgLogos(clone, {
      assetBase: ASSET_BASE,
      variant: 'horizontal',
      horizontalHeight: 28,
    });
    clone.querySelectorAll('.dr-cover, .dr-doc').forEach((el) => {
      el.style.maxWidth = 'none';
      el.style.width = '100%';
      el.style.minHeight = 'auto';
    });
    return clone;
  }

  async function loadSections() {
    const res = await fetch('design-resources.html');
    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const map = {};
    CARDS.forEach((card) => {
      if (card.sectionId) {
        map[card.key] = doc.getElementById(card.sectionId);
      }
    });
    return map;
  }

  function placeCard(card, innerNode) {
    const wrap = document.createElement('div');
    wrap.className = 'ds-board-card';
    wrap.style.cssText = `left:${card.x}px;top:${card.y}px;width:${card.w}px;height:${card.h}px`;
    wrap.dataset.nodeId = card.nodeId;
    wrap.dataset.cardKey = card.key;

    const slot = document.createElement('div');
    slot.className = 'ds-board-card__slot';
    if (innerNode) {
      if (typeof innerNode === 'string') {
        slot.innerHTML = innerNode;
      } else {
        slot.appendChild(innerNode);
      }
    }
    wrap.appendChild(slot);
    return wrap;
  }

  function fitShowcase(root) {
    if (!root) return;
    const wrap = root.querySelector('[data-ds-board-wrap]');
    const board = root.querySelector('[data-ds-board]');
    if (window.matchMedia('(max-width: 900px)').matches) {
      if (board) board.style.transform = '';
      if (wrap) {
        wrap.style.height = '';
        wrap.style.overflowX = '';
      }
      return;
    }
    if (board) board.style.transform = '';
    if (wrap) {
      wrap.style.height = `${BOARD.h}px`;
      wrap.style.overflowX = 'auto';
      wrap.style.overflowY = 'hidden';
    }
  }

  function renderResponsiveNav() {
    const links = CARDS.map((c) => {
      const label = c.key === 'tma' ? 'TMA Design System'
        : c.key.charAt(0).toUpperCase() + c.key.slice(1);
      return `<a class="ds-responsive__link" href="#card-${esc(c.key)}" data-node-id="${esc(c.nodeId)}">${esc(label)}</a>`;
    }).join('');
    return `<nav class="ds-responsive" data-node-id="${BOARD.nodeId}-responsive" aria-label="Design system sections">
      <h2 class="ds-responsive__title">Design system</h2>
      <p class="ds-responsive__copy">Browse TM ANTOINE Advisory design system documentation cards from Figma node ${esc(BOARD.nodeId)}.</p>
      <div class="ds-responsive__grid">${links}</div>
      <p class="ds-responsive__note"><a href="design-resources.html">Open stacked documentation view ↗</a></p>
    </nav>`;
  }

  async function mountDesignSystemPage(root) {
    if (!root) return;
    root.innerHTML = `<div class="ds-demo__stage">
      <div class="ds-demo__board-wrap" data-ds-board-wrap>
        <div class="ds-demo__board" data-ds-board style="width:${BOARD.w}px;height:${BOARD.h}px" data-node-id="${BOARD.nodeId}"></div>
      </div>
      ${renderResponsiveNav()}
    </div>`;

    const board = root.querySelector('[data-ds-board]');
    const sections = await loadSections();

    CARDS.forEach((card) => {
      let content = null;
      if (card.type === 'cover-snow') {
        content = renderTMACover();
      } else if (card.type === 'colors' && window.TMADesignSystemColors) {
        content = window.TMADesignSystemColors.renderColorsCard({ assetBase: ASSET_BASE });
      } else if (card.sectionId) {
        content = prepareSection(sections[card.key], card.key);
      }
      const node = placeCard(card, content);
      node.id = `card-${card.key}`;
      board.appendChild(node);
      if (typeof content === 'string') {
        window.TMALogo.replaceImgLogos(node, {
          assetBase: ASSET_BASE,
          variant: 'horizontal',
          horizontalHeight: 24,
        });
      }
    });

    const fit = () => fitShowcase(root);
    fit();
    requestAnimationFrame(() => { fit(); requestAnimationFrame(fit); });
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(fit);
      ro.observe(root);
    }
    window.addEventListener('resize', fit);
  }

  window.TMADesignSystemPage = {
    mountDesignSystemPage,
    fitShowcase,
    BOARD,
    CARDS,
  };
})();
