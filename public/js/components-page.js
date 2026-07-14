/* TMA - Components board (Figma 33320:6937) */
(function () {
  'use strict';

  const BOARD = {
    w: 6480,
    h: 4258,
    nodeId: '33320:6937',
    svg: 'images/components/board-33320-6937.svg',
    communityUrl: 'https://www.figma.com/community/file/1388431032861751537',
  };

  const HERO = {
    components: {
      nodeId: '33320:7286',
      x: 100,
      y: 100,
      w: 1600,
      h: 2958,
      title: 'Components',
      body: 'Most elements are made using the components here, please back up before modifying.',
      linkLabel: 'TMA Design System',
      linkY: 2600,
    },
    mobile: {
      nodeId: '33320:7287',
      x: 100,
      y: 3160,
      w: 1600,
      h: 998,
      titleLines: ['Mobile', 'components'],
      bodyLines: [
        'Use Apple Design Resources - iOS 18 and iPadOS 18',
        'These components are used in TMA.',
      ],
    },
  };

  const SECTION_LINKS = [
    { nodeId: '33320:7132', x: 1800, y: 100, w: 140, h: 40, label: 'Button', href: 'button-instances.html' },
    { nodeId: '33320:7181', x: 1800, y: 588, w: 90, h: 40, label: 'Image', href: 'frame-instances.html' },
    { nodeId: '33320:7131', x: 2512, y: 588, w: 100, h: 40, label: 'Icon', href: 'frame-documentation.html' },
    { nodeId: '33320:7175', x: 2980, y: 588, w: 100, h: 40, label: 'Text', href: 'text-instances.html' },
    { nodeId: '33320:7133', x: 4308, y: 588, w: 150, h: 40, label: 'IconText', href: 'icon-text-documentation.html' },
    { nodeId: '33320:7134', x: 4505, y: 588, w: 120, h: 40, label: 'Frame', href: 'frame-instances.html' },
    { nodeId: '33320:7135', x: 4890, y: 588, w: 120, h: 40, label: 'Group', href: 'group-instances.html' },
    { nodeId: '33320:7180', x: 5490, y: 588, w: 100, h: 40, label: 'Tag', href: 'tag-documentation.html' },
    { nodeId: '33320:7179', x: 5802, y: 588, w: 120, h: 40, label: 'Badge', href: 'badge-documentation.html' },
    { nodeId: '33320:7190', x: 1800, y: 1360, w: 110, h: 40, label: 'Card', href: 'card-instances.html' },
    { nodeId: '33320:7191', x: 2580, y: 1360, w: 110, h: 40, label: 'Toast', href: 'toast-guidance.html' },
    { nodeId: '33320:7257', x: 2802, y: 1360, w: 110, h: 40, label: 'Input', href: 'input-documentation.html' },
    { nodeId: '33320:7201', x: 3382, y: 1360, w: 140, h: 40, label: 'Popover', href: 'popover-instances.html' },
    { nodeId: '33320:7189', x: 4522, y: 1360, w: 130, h: 40, label: 'Search', href: 'frame-instances.html' },
    { nodeId: '33320:7202', x: 2320, y: 2266, w: 170, h: 40, label: 'DatePicker', href: 'date-picker-documentation.html' },
    { nodeId: '33320:7185', x: 3100, y: 2266, w: 130, h: 40, label: 'Activities', href: 'frame-instances.html' },
    { nodeId: '33320:7186', x: 3388, y: 2266, w: 120, h: 40, label: 'Contacts', href: 'frame-instances.html' },
    { nodeId: '33320:7187', x: 3676, y: 2266, w: 170, h: 40, label: 'Notifications', href: 'frame-instances.html' },
    { nodeId: '33320:7212', x: 4001, y: 1992, w: 120, h: 40, label: 'Tooltip', href: 'frame-documentation.html' },
    { nodeId: '33320:7238', x: 2710, y: 1992, w: 100, h: 40, label: 'Line', href: 'line-documentation.html' },
    { nodeId: '33320:7223', x: 2356, y: 1992, w: 100, h: 40, label: 'Strip', href: 'strip-documentation.html' },
    { nodeId: '33320:7196', x: 4150, y: 1992, w: 90, h: 40, label: 'Tab', href: 'frame-documentation.html' },
  ];

  function esc(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function imagesBase(subpath) {
    if (typeof location === 'undefined') return `../${subpath}`;
    const segments = (location.pathname || '').split('/').filter(Boolean);
    if (segments.length && /\.[a-z0-9]+$/i.test(segments[segments.length - 1])) segments.pop();
    if (segments.length === 0) return subpath;
    return `${'../'.repeat(segments.length)}${subpath}`;
  }

  function place(x, y, w, h, html, nodeId) {
    const size = w != null && h != null ? `width:${w}px;height:${h}px;` : '';
    return `<div class="tma-components-board__node" style="left:${x}px;top:${y}px;${size}" data-node-id="${esc(nodeId)}">${html}</div>`;
  }

  function renderHeroTitle(lines, single) {
    if (single) {
      return `<h2 class="tma-components-hero__title">${esc(single)}</h2>`;
    }
    return `<h2 class="tma-components-hero__title">${lines.map((line) => `<span class="tma-components-hero__title-line">${esc(line)}</span>`).join('')}</h2>`;
  }

  function renderHeroPanel(opts) {
    const o = opts || {};
    const body = o.body
      ? `<p class="tma-components-hero__body">${esc(o.body)}</p>`
      : (o.bodyLines || []).map((line) => `<p class="tma-components-hero__body">${esc(line)}</p>`).join('');
    const link = o.linkLabel
      ? `<a class="tma-components-hero__link" href="${esc(BOARD.communityUrl)}" target="_blank" rel="noopener noreferrer">${esc(o.linkLabel)}<span aria-hidden="true"> ↗</span></a>`
      : '';
    return `<div class="tma-components-hero" style="width:${o.w}px;height:${o.h}px">
      <div class="tma-components-hero__content">
        ${renderHeroTitle(o.titleLines, o.title)}
        ${body}
        ${link}
      </div>
    </div>`;
  }

  function renderHotspot(item) {
    return `<a class="tma-components-board__hotspot" href="${esc(item.href)}" style="left:${item.x}px;top:${item.y}px;width:${item.w}px;height:${item.h}px" data-node-id="${esc(item.nodeId)}" aria-label="${esc(item.label)} documentation"><span class="tma-components-board__hotspot-label">${esc(item.label)}</span></a>`;
  }

  function renderCommunityHotspot() {
    const h = HERO.components;
    return `<a class="tma-components-board__hotspot tma-components-board__hotspot--community" href="${esc(BOARD.communityUrl)}" target="_blank" rel="noopener noreferrer" style="left:${h.x + 160}px;top:${h.y + 2480}px;width:${h.w - 320}px;height:120px" data-node-id="I${h.nodeId};link" aria-label="TMA Design System on Figma Community"><span class="tma-components-board__sr-only">TMA Design System</span></a>`;
  }

  function renderMainBoard() {
    const svgSrc = imagesBase(BOARD.svg);
    const parts = [];

    parts.push(`<div class="tma-components-board" data-node-id="${BOARD.nodeId}" style="width:${BOARD.w}px;height:${BOARD.h}px">
      <img class="tma-components-board__svg" src="${esc(svgSrc)}" width="${BOARD.w}" height="${BOARD.h}" alt="TMA Components catalog" decoding="async" />
      <div class="tma-components-board__overlay" aria-hidden="false">`);

    parts.push(place(HERO.components.x, HERO.components.y, HERO.components.w, HERO.components.h, renderHeroPanel(HERO.components), HERO.components.nodeId));
    parts.push(place(HERO.mobile.x, HERO.mobile.y, HERO.mobile.w, HERO.mobile.h, renderHeroPanel(HERO.mobile), HERO.mobile.nodeId));

    SECTION_LINKS.forEach((item) => {
      parts.push(renderHotspot(item));
    });
    parts.push(renderCommunityHotspot());

    parts.push('</div></div>');
    return parts.join('');
  }

  function renderResponsiveSections() {
    const heroes = `
      <section class="tma-components-responsive__section">
        ${renderHeroPanel({ ...HERO.components, w: 'auto', h: 'auto' })}
      </section>
      <section class="tma-components-responsive__section">
        ${renderHeroPanel({ ...HERO.mobile, w: 'auto', h: 'auto' })}
      </section>`;

    const links = SECTION_LINKS.map((item) => (
      `<a class="tma-components-responsive__link" href="${esc(item.href)}" data-node-id="${esc(item.nodeId)}">${esc(item.label)}</a>`
    )).join('');

    return `<div class="tma-components-responsive" data-node-id="${BOARD.nodeId}-responsive">
      ${heroes}
      <section class="tma-components-responsive__section">
        <h3 class="tma-components-responsive__heading">Component sections</h3>
        <div class="tma-components-responsive__grid">${links}</div>
      </section>
      <section class="tma-components-responsive__section">
        <a class="tma-components-responsive__cta" href="${esc(BOARD.communityUrl)}" target="_blank" rel="noopener noreferrer">Get TMA on Figma Community ↗</a>
      </section>
    </div>`;
  }

  function renderComponentsPage() {
    return `<div class="tma-components-demo__stage" data-components-showcase>
      <div class="tma-components-demo__board-wrap tma-components-demo__board-wrap--main">
        <div class="tma-components-demo__boards tma-components-demo__boards--catalog" data-components-board-main>
          ${renderMainBoard()}
        </div>
      </div>
      ${renderResponsiveSections()}
    </div>`;
  }

  function fitBoard(wrap, board, designW, designH) {
    if (!wrap || !board) return;
    const available = wrap.clientWidth;
    if (!available) {
      board.style.transform = '';
      wrap.style.height = `${designH}px`;
      return;
    }
    const scale = Math.min(1, available / designW);
    board.style.transform = scale < 1 ? `scale(${scale})` : '';
    wrap.style.height = `${Math.max(200, Math.ceil(designH * scale))}px`;
  }

  function fitShowcase(root) {
    if (!root) return;
    const mainWrap = root.querySelector('.tma-components-demo__board-wrap--main');
    const mainBoard = root.querySelector('[data-components-board-main]');

    if (window.matchMedia('(max-width: 900px)').matches) {
      if (mainBoard) mainBoard.style.transform = '';
      if (mainWrap) mainWrap.style.height = '';
      return;
    }

    fitBoard(mainWrap, mainBoard, BOARD.w, BOARD.h);
  }

  function mountComponentsPage(el) {
    if (!el) return;
    el.innerHTML = renderComponentsPage();

    const fit = () => fitShowcase(el);
    fit();
    requestAnimationFrame(() => {
      fit();
      requestAnimationFrame(fit);
    });

    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(fit);
      ro.observe(el);
    }

    window.addEventListener('resize', fit);
  }

  window.TMAComponentsPage = {
    mountComponentsPage,
    renderComponentsPage,
    fitShowcase,
    BOARD,
    HERO,
    SECTION_LINKS,
  };
})();
