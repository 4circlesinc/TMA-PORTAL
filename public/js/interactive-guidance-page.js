/* TMA - Interactive guidance board (Figma 12779:273712) */
(function () {
  'use strict';

  const BOARD = { w: 17981, h: 14515, nodeId: '12779:273712' };

  const PANELS = [
    { key: 'nav-shared', nodeId: '30992:280837', x: 0, y: 0, w: 1400, h: 2168, type: 'navigation', label: 'Shared' },
    { key: 'primary', nodeId: '30484:299252', x: 1600, y: 0, w: 1200, h: 2148, type: 'primary' },
    { key: 'data-formats', nodeId: '30484:299253', x: 2900, y: 0, w: 1200, h: 2564, type: 'coded', coded: 'dataFormats' },
    { key: 'component-state', nodeId: '30484:299251', x: 4200, y: 0, w: 2322, h: 3789, type: 'coded', coded: 'componentState' },
    { key: 'search', nodeId: '30484:299244', x: 6622, y: 0, w: 1600, h: 3092, type: 'embed', title: 'Search interactive guidance', href: 'search-guidance.html' },
    { key: 'toast', nodeId: '30484:299245', x: 8322, y: 0, w: 1600, h: 2128, type: 'embed', title: 'Toast', href: 'toast-guidance.html' },
    { key: 'tooltip', nodeId: '30484:299246', x: 10022, y: 0, w: 1200, h: 2650, type: 'embed', title: 'Tooltip documentation', href: 'tooltip.html' },
    { key: 'popover', nodeId: '30484:299249', x: 11322, y: 0, w: 1432, h: 3220, type: 'mount', title: 'Popover', href: 'popover-guidance.html' },
    { key: 'forms', nodeId: '30484:299243', x: 12854, y: 0, w: 2322, h: 2356, type: 'mount', title: 'Forms', href: 'forms-guidance.html' },
    { key: 'datepicker', nodeId: '30484:299247', x: 15276, y: 0, w: 2705, h: 3577, type: 'mount', title: 'DatePicker', href: 'date-picker-guidance.html' },

    { key: 'nav-dashboard', nodeId: '30992:280838', x: 0, y: 4795, w: 1400, h: 5348, type: 'navigation', label: 'Dashboard' },
    { key: 'layout', nodeId: '30484:299256', x: 1600, y: 4787, w: 2036, h: 5334, type: 'coded', coded: 'layout' },
    { key: 'block', nodeId: '30484:299254', x: 3736, y: 4787, w: 1496, h: 1656, type: 'embed', title: 'Block', href: 'chart-motion-01.html' },
    { key: 'sidebar', nodeId: '30484:299255', x: 5332, y: 4787, w: 1200, h: 2794, type: 'coded', coded: 'sidebar' },
    { key: 'rightbar', nodeId: '30484:299250', x: 6632, y: 4787, w: 1200, h: 2306, type: 'coded', coded: 'rightbar' },
    { key: 'header', nodeId: '30484:299248', x: 7932, y: 4787, w: 1349, h: 902, type: 'coded', coded: 'header' },

    { key: 'nav-table', nodeId: '30992:280839', x: 0, y: 11143, w: 1400, h: 2157, type: 'navigation', label: 'Table' },
    { key: 'table-a', nodeId: '30484:299241', x: 1600, y: 11127, w: 1581, h: 2149, type: 'embed', title: 'Table A interactive guidance', href: 'table-c.html' },
    { key: 'table-b', nodeId: '30484:299238', x: 3281, y: 11127, w: 1849, h: 2068, type: 'embed', title: 'Table B', href: 'table-b-guidance.html' },
    { key: 'table-search', nodeId: '30484:299242', x: 5230, y: 11127, w: 1327, h: 1864, type: 'embed', title: 'Search results', href: 'table-search-guidance.html' },
    { key: 'add-data', nodeId: '30484:299239', x: 6657, y: 11127, w: 1959, h: 1744, type: 'embed', title: 'Add data', href: 'table-add-data-guidance.html' },
    { key: 'filter-sort', nodeId: '30484:299240', x: 8716, y: 11127, w: 1397, h: 3388, type: 'embed', title: 'Filter and sort', href: 'table-filter-sort-guidance.html' },
  ];

  const ROWS = [
    { key: 'shared', label: 'Shared', panels: ['nav-shared', 'primary', 'data-formats', 'component-state', 'search', 'toast', 'tooltip', 'popover', 'forms', 'datepicker'] },
    { key: 'dashboard', label: 'Dashboard', panels: ['nav-dashboard', 'layout', 'block', 'sidebar', 'rightbar', 'header'] },
    { key: 'table', label: 'Table', panels: ['nav-table', 'table-a', 'table-b', 'table-search', 'add-data', 'filter-sort'] },
  ];

  function esc(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  const CODED_RENDERERS = {
    dataFormats: () => window.TMAInteractiveGuidanceDataFormats && window.TMAInteractiveGuidanceDataFormats.renderDataFormats(),
    header: () => window.TMAInteractiveGuidanceDashboard && window.TMAInteractiveGuidanceDashboard.renderHeader(),
    sidebar: () => window.TMAInteractiveGuidanceSidebar && window.TMAInteractiveGuidanceSidebar.renderSidebar(),
    rightbar: () => window.TMAInteractiveGuidanceRightbar && window.TMAInteractiveGuidanceRightbar.renderRightbar(),
    layout: () => window.TMAInteractiveGuidanceDashboard && window.TMAInteractiveGuidanceDashboard.renderLayout(),
    componentState: () => window.TMAInteractiveGuidanceComponentState && window.TMAInteractiveGuidanceComponentState.renderComponentState(),
  };

  const MOUNT_PANELS = {
    forms: { api: 'TMAFormsGuidance', slot: 'ig-mount-forms' },
    popover: { api: 'TMAPopoverGuidance', slot: 'ig-mount-popover' },
    datepicker: { api: 'TMADatePickerGuidance', slot: 'ig-mount-datepicker' },
  };

  function renderEmbed(panel) {
    return `<div class="ig-embed" data-node-id="${esc(panel.nodeId)}">
      <iframe class="ig-embed__frame" src="${esc(panel.href)}" title="${esc(panel.title)}" scrolling="yes"></iframe>
      <a class="ig-embed__open" href="${esc(panel.href)}" target="_blank" rel="noopener noreferrer">Open ${esc(panel.title)} ↗</a>
    </div>`;
  }

  function renderMount(panel) {
    const cfg = MOUNT_PANELS[panel.key];
    if (!cfg) return renderEmbed(panel);
    return `<div class="ig-mount" data-node-id="${esc(panel.nodeId)}">
      <div class="ig-mount__slot" id="${esc(cfg.slot)}"></div>
      <a class="ig-embed__open" href="${esc(panel.href)}" target="_blank" rel="noopener noreferrer">Open ${esc(panel.title)} ↗</a>
    </div>`;
  }

  function renderPlaceholder(panel) {
    const link = panel.href
      ? `<a class="ig-placeholder__link" href="${esc(panel.href)}" target="_blank" rel="noopener noreferrer">Open demo ↗</a>`
      : '';
    return `<article class="ig-placeholder" data-node-id="${esc(panel.nodeId)}">
      <h2 class="ig-placeholder__title">${esc(panel.title)}</h2>
      <p class="ig-placeholder__copy">Interactive guidance panel from Figma node ${esc(panel.nodeId)}. Standalone implementation pending.</p>
      ${link}
    </article>`;
  }

  function renderPanelContent(panel) {
    if (panel.type === 'navigation' && window.TMAInteractiveGuidanceNav) {
      return window.TMAInteractiveGuidanceNav.renderNavigationCard(panel.label, panel.nodeId);
    }
    if (panel.type === 'primary' && window.TMAInteractiveGuidancePrimary) {
      return window.TMAInteractiveGuidancePrimary.renderPrimaryGuide();
    }
    if (panel.type === 'coded' && panel.coded && CODED_RENDERERS[panel.coded]) {
      return CODED_RENDERERS[panel.coded]() || '';
    }
    if (panel.type === 'mount') return renderMount(panel);
    if (panel.type === 'embed') return renderEmbed(panel);
    if (panel.type === 'placeholder') return renderPlaceholder(panel);
    return '';
  }

  function mountGuidancePanels(board) {
    Object.keys(MOUNT_PANELS).forEach((key) => {
      const cfg = MOUNT_PANELS[key];
      const api = window[cfg.api];
      const slot = board.querySelector(`#${cfg.slot}`);
      if (api && typeof api.mountGuidance === 'function' && slot) {
        api.mountGuidance(slot);
      }
    });
    if (window.TMAInput && typeof window.TMAInput.mountInteractive === 'function') {
      window.TMAInput.mountInteractive(board);
    }
  }

  function placePanel(panel) {
    const wrap = document.createElement('div');
    wrap.className = 'ig-board-card';
    wrap.style.cssText = `left:${panel.x}px;top:${panel.y}px;width:${panel.w}px;height:${panel.h}px`;
    wrap.dataset.nodeId = panel.nodeId;
    wrap.dataset.cardKey = panel.key;
    wrap.id = `card-${panel.key}`;

    const slot = document.createElement('div');
    slot.className = 'ig-board-card__slot';
    slot.innerHTML = renderPanelContent(panel);
    wrap.appendChild(slot);
    return wrap;
  }

  function fitShowcase(root) {
    if (!root) return;
    const wrap = root.querySelector('[data-ig-board-wrap]');
    const board = root.querySelector('[data-ig-board]');
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
      wrap.style.height = `min(85vh, ${BOARD.h}px)`;
      wrap.style.overflowX = 'auto';
      wrap.style.overflowY = 'auto';
    }
  }

  function renderResponsiveNav() {
    const sections = ROWS.map((row) => {
      const links = row.panels
        .filter((key) => !key.startsWith('nav-'))
        .map((key) => {
          const panel = PANELS.find((p) => p.key === key);
          if (!panel) return '';
          const label = panel.title || panel.label || panel.key;
          const href = panel.href ? esc(panel.href) : `#card-${esc(key)}`;
          const target = panel.href ? ' target="_blank" rel="noopener noreferrer"' : '';
          const panelKey = panel.href ? '' : ` data-panel-key="${esc(key)}"`;
          return `<a class="ig-responsive__link" href="${href}"${target}${panelKey} data-node-id="${esc(panel.nodeId)}">${esc(label)}</a>`;
        })
        .join('');
      return `<section class="ig-responsive__section">
        <h3 class="ig-responsive__section-title">${esc(row.label)}</h3>
        <div class="ig-responsive__grid">${links}</div>
      </section>`;
    }).join('');

    return `<nav class="ig-responsive" data-node-id="${BOARD.nodeId}-responsive" aria-label="Interactive guidance sections">
      <h2 class="ig-responsive__title">Interactive guidance</h2>
      <p class="ig-responsive__copy">Browse TMA interactive guidance boards from Figma node ${esc(BOARD.nodeId)}. On desktop, scroll horizontally through the full canvas; on mobile, jump to individual panels.</p>
      ${sections}
    </nav>`;
  }

  function panelKeyFromHash() {
    const match = (window.location.hash || '').match(/^#card-(.+)$/);
    return match ? match[1] : '';
  }

  function isMobileGuidance() {
    return window.matchMedia('(max-width: 900px)').matches;
  }

  function showMobilePanel(root, key) {
    const panel = PANELS.find((p) => p.key === key);
    const viewer = root.querySelector('[data-ig-mobile-viewer]');
    if (!panel || !viewer) return;

    viewer.hidden = false;
    viewer.innerHTML = renderPanelContent(panel);
    if (window.TMALogo) {
      window.TMALogo.replaceImgLogos(viewer);
    }
    mountGuidancePanels(viewer);
    viewer.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function scrollToPanel(root, key) {
    const card = document.getElementById(`card-${key}`);
    const wrap = root.querySelector('[data-ig-board-wrap]');
    if (!card || !wrap) return;

    if (isMobileGuidance()) {
      showMobilePanel(root, key);
      return;
    }

    wrap.scrollTo({
      left: Math.max(0, card.offsetLeft - 24),
      top: Math.max(0, card.offsetTop - 24),
      behavior: 'smooth',
    });
  }

  function wirePanelNavigation(root) {
    root.addEventListener('click', (event) => {
      const link = event.target.closest('[data-panel-key]');
      if (!link || !root.contains(link)) return;
      event.preventDefault();
      const key = link.getAttribute('data-panel-key');
      if (!key) return;
      window.location.hash = `card-${key}`;
      scrollToPanel(root, key);
    });

    window.addEventListener('hashchange', () => {
      const key = panelKeyFromHash();
      if (key) scrollToPanel(root, key);
    });
  }

  function mountInteractiveGuidancePage(root) {
    if (!root) return;
    root.innerHTML = `<div class="ig-demo__stage">
      <div class="ig-demo__board-wrap" data-ig-board-wrap>
        <div class="ig-demo__board" data-ig-board style="width:${BOARD.w}px;height:${BOARD.h}px" data-node-id="${BOARD.nodeId}"></div>
      </div>
      ${renderResponsiveNav()}
      <div class="ig-mobile-viewer" data-ig-mobile-viewer hidden></div>
    </div>`;

    const board = root.querySelector('[data-ig-board]');
    PANELS.forEach((panel) => {
      board.appendChild(placePanel(panel));
    });

    if (window.TMALogo) {
      window.TMALogo.replaceImgLogos(board);
    }

    mountGuidancePanels(board);
    wirePanelNavigation(root);

    const fit = () => fitShowcase(root);
    fit();
    requestAnimationFrame(() => {
      fit();
      requestAnimationFrame(() => {
        fit();
        const key = panelKeyFromHash();
        if (key) scrollToPanel(root, key);
      });
    });
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(fit);
      ro.observe(root);
    }
    window.addEventListener('resize', fit);
  }

  window.TMAInteractiveGuidancePage = {
    mountInteractiveGuidancePage,
    fitShowcase,
    scrollToPanel,
    BOARD,
    PANELS,
    ROWS,
  };
})();
