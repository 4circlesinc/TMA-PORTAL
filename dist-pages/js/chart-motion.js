/**
 * ChartMotion interactions — bar tooltips (touch) and line chart cursor tracking.
 */
(function () {
  const CHART_SELECTOR = '.tma-chart-motion, .tma-chart-motion-horizontal, .tma-chart-motion-line, .tma-chart-vertical-01, .tma-chart-vertical-02, .tma-chart-vertical-03, .tma-chart-vertical-04, .tma-chart-vertical-05, .tma-chart-vertical-06, .tma-chart-vertical-07, .tma-chart-vertical-08, .tma-chart-vertical-09, .tma-chart-vertical-10, .tma-chart-vertical-11, .tma-chart-vertical-12, .tma-chart-horizontal-01, .tma-chart-horizontal-02, .tma-chart-horizontal-03, .tma-chart-horizontal-04, .tma-chart-semicircle, .tma-chart-donut';

  const BAR_SELECTORS = [
    '.tma-chart-motion__bar',
    '.tma-chart-motion-horizontal__bar',
    '.tma-chart-vertical-01__bar',
    '.tma-chart-vertical-02__bar',
    '.tma-chart-vertical-03__bar',
    '.tma-chart-vertical-04__bar',
    '.tma-chart-vertical-05__bar',
    '.tma-chart-vertical-06__bar',
    '.tma-chart-vertical-07__bar',
    '.tma-chart-vertical-08__bar',
    '.tma-chart-vertical-09__strip',
    '.tma-chart-vertical-10__bar',
    '.tma-chart-vertical-11__bar',
    '.tma-chart-vertical-12__bar',
    '.tma-chart-horizontal-01__bar',
    '.tma-chart-horizontal-02__bar',
    '.tma-chart-horizontal-03__bar',
    '.tma-chart-horizontal-04__bar',
  ].join(',');

  function chartRoots(scope) {
    if (!scope || scope === document) {
      return document.querySelectorAll(CHART_SELECTOR);
    }

    if (scope.matches && scope.matches(CHART_SELECTOR)) {
      return [scope];
    }

    return scope.querySelectorAll(CHART_SELECTOR);
  }

  function initBarChart(root) {
    const items = root.querySelectorAll(BAR_SELECTORS);
    if (!items.length) return;

    items.forEach((item) => {
      item.addEventListener('click', (event) => {
        if (window.matchMedia('(hover: hover)').matches) return;

        event.stopPropagation();
        const wasActive = item.classList.contains('is-active');

        items.forEach((el) => el.classList.remove('is-active'));
        if (!wasActive) item.classList.add('is-active');
      });
    });

    document.addEventListener('click', () => {
      items.forEach((item) => item.classList.remove('is-active'));
    });
  }

  function formatValue(value) {
    return Math.round(value).toLocaleString();
  }

  function parsePlot(root) {
    try {
      return JSON.parse(root.dataset.plot || '{}');
    } catch {
      return null;
    }
  }

  function svgPointToHoverPercent(svg, hoverEl, x, y) {
    const hoverRect = hoverEl.getBoundingClientRect();
    const point = svg.createSVGPoint();
    point.x = x;
    point.y = y;

    const matrix = svg.getScreenCTM();
    if (!matrix) {
      return { left: 0, top: 0 };
    }

    const screen = point.matrixTransform(matrix);

    return {
      left: ((screen.x - hoverRect.left) / hoverRect.width) * 100,
      top: ((screen.y - hoverRect.top) / hoverRect.height) * 100,
    };
  }

  function clientXToSvgX(svg, hoverEl, plot, clientX) {
    const hoverRect = hoverEl.getBoundingClientRect();
    const ratio = (clientX - hoverRect.left) / hoverRect.width;
    return plot.x + ratio * plot.width;
  }

  function valueFromY(plot, yMax, y) {
    const baseline = plot.y + plot.height;
    const top = plot.y;
    const ratio = (baseline - y) / (baseline - top);
    return Math.max(0, Math.min(yMax, ratio * yMax));
  }

  function pointAtX(path, targetX) {
    const length = path.getTotalLength();
    if (!length) return null;

    let lo = 0;
    let hi = length;

    for (let i = 0; i < 80; i++) {
      const mid = (lo + hi) / 2;
      const x = path.getPointAtLength(mid).x;
      if (x < targetX) lo = mid;
      else hi = mid;
    }

    return path.getPointAtLength((lo + hi) / 2);
  }

  function initLineChart(root) {
    if (root.dataset.chartMotionLineInit === 'true') return;

    const plot = parsePlot(root);
    const yMax = Number(root.dataset.ymax || 0);
    const plotEl = root.querySelector('.tma-chart-motion-line__plot');
    const hoverEl = root.querySelector('.tma-chart-motion-line__hover');
    const cursorEl = root.querySelector('.tma-chart-motion-line__cursor');
    const tooltipEl = root.querySelector('.tma-chart-motion-line__tooltip');
    const svg = root.querySelector('.tma-chart-motion-line__svg');
    const linePath = root.querySelector('.tma-chart-motion-line__stroke');

    if (!plot || !plotEl || !hoverEl || !cursorEl || !tooltipEl || !svg || !linePath || !yMax) {
      return;
    }

    const setup = () => {
      if (!linePath.getTotalLength()) return false;

      root.dataset.chartMotionLineInit = 'true';

      const xMin = plot.x;
      const xMax = plot.x + plot.width;

      function hideCursor() {
        cursorEl.classList.remove('is-visible');
        root.classList.remove('is-hovering');
      }

      function showAtClientX(clientX) {
        const svgX = clientXToSvgX(svg, hoverEl, plot, clientX);

        if (svgX < xMin || svgX > xMax) {
          hideCursor();
          return;
        }

        const pt = pointAtX(linePath, svgX);
        if (!pt) {
          hideCursor();
          return;
        }

        const pct = svgPointToHoverPercent(svg, hoverEl, pt.x, pt.y);
        const value = valueFromY(plot, yMax, pt.y);

        cursorEl.style.left = `${pct.left}%`;
        cursorEl.style.top = `${pct.top}%`;
        tooltipEl.textContent = formatValue(value);
        cursorEl.classList.add('is-visible');
        root.classList.add('is-hovering');
      }

      function onMove(event) {
        if (event.touches && event.touches.length === 0) return;
        const clientX = event.touches ? event.touches[0].clientX : event.clientX;
        showAtClientX(clientX);
      }

      hoverEl.addEventListener('mousemove', onMove);
      hoverEl.addEventListener('mouseenter', onMove);
      hoverEl.addEventListener('mouseleave', hideCursor);

      hoverEl.addEventListener('touchstart', onMove, { passive: true });
      hoverEl.addEventListener('touchmove', onMove, { passive: true });
      hoverEl.addEventListener('touchend', hideCursor);
      hoverEl.addEventListener('touchcancel', hideCursor);

      root.setAttribute('tabindex', '0');
      const pointCount = root.querySelectorAll('.tma-chart-motion-line__x-label').length || 12;

      root.addEventListener('keydown', (event) => {
        if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;

        event.preventDefault();
        const step = plot.width / Math.max(1, pointCount - 1);
        const hoverRect = hoverEl.getBoundingClientRect();
        const currentLeft = parseFloat(cursorEl.style.left || '0') / 100;
        const currentClientX = hoverRect.left + currentLeft * hoverRect.width;
        const currentSvgX = clientXToSvgX(svg, hoverEl, plot, currentClientX);
        const nextX = event.key === 'ArrowRight'
          ? Math.min(xMax, currentSvgX + step)
          : Math.max(xMin, currentSvgX - step);
        const nextClientX = hoverRect.left + ((nextX - plot.x) / plot.width) * hoverRect.width;

        showAtClientX(nextClientX);
      });

      return true;
    };

    if (setup()) return;

    requestAnimationFrame(() => {
      if (root.dataset.chartMotionLineInit === 'true') return;
      setup();
    });
  }

  function initPathSegmentChart(root, prefix) {
    const segments = root.querySelectorAll(`.${prefix}__segment`);
    const tooltips = root.querySelectorAll(`.${prefix}__tooltip`);
    if (!segments.length) return;

    const hideAll = () => {
      tooltips.forEach((tooltip) => tooltip.classList.remove('is-visible'));
      segments.forEach((segment) => segment.classList.remove('is-active'));
    };

    segments.forEach((segment, index) => {
      const show = () => {
        hideAll();
        segment.classList.add('is-active');
        tooltips[index]?.classList.add('is-visible');
      };

      segment.addEventListener('mouseenter', show);
      segment.addEventListener('focus', show);
      segment.addEventListener('mouseleave', hideAll);
      segment.addEventListener('blur', hideAll);
      segment.addEventListener('click', (event) => {
        if (window.matchMedia('(hover: hover)').matches) return;

        event.stopPropagation();
        const wasActive = segment.classList.contains('is-active');
        hideAll();
        if (!wasActive) show();
      });
    });

    document.addEventListener('click', hideAll);
  }

  function initChart(root) {
    if (root.classList.contains('tma-chart-motion-line')) {
      initLineChart(root);
      return;
    }

    if (root.classList.contains('tma-chart-semicircle')) {
      initPathSegmentChart(root, 'tma-chart-semicircle');
      return;
    }

    if (root.classList.contains('tma-chart-donut')) {
      initPathSegmentChart(root, 'tma-chart-donut');
      return;
    }

    initBarChart(root);
  }

  function initAll(scope) {
    chartRoots(scope || document).forEach(initChart);
  }

  window.PortalChartMotion = { init: initAll, initChart };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => initAll());
  } else {
    initAll();
  }
})();
