/* TMA — Strip component (Figma 32792:9423) */
(function () {
  'use strict';

  const svg = (key, cls, w, h) => (window.TMAStripIcons && window.TMAStripIcons.svg(key, cls, w, h)) || '';

  function esc(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function segmentHtml(color) {
    const cls = color ? ` tma-strip__segment--${esc(color)}` : '';
    return `<span class="tma-strip__segment${cls}"></span>`;
  }

  function renderStrip(opts) {
    const o = opts || {};
    const nodeId = o.nodeId || '';
    const nodeAttr = nodeId ? ` data-node-id="${esc(nodeId)}"` : '';
    const segments = o.segments || [];
    const height = o.height || 8;
    const width = o.width != null ? ` style="width:${o.width}px${o.paddingRight != null ? `;padding-right:${o.paddingRight}px` : ''}"` : (o.paddingRight != null ? ` style="padding-right:${o.paddingRight}px"` : '');
    const classes = [
      'tma-strip',
      `tma-strip--h${height}`,
      o.track ? 'tma-strip--track' : '',
      o.bar ? 'tma-strip--bar' : '',
      o.className || '',
    ].filter(Boolean).join(' ');

    const segmentsHtml = segments.map((color) => segmentHtml(color)).join('');
    return `<div class="${classes}"${nodeAttr}${width}>${segmentsHtml}</div>`;
  }

  function renderTextPair(opts) {
    const o = opts || {};
    const nodeId = o.nodeId || '';
    const nodeAttr = nodeId ? ` data-node-id="${esc(nodeId)}"` : '';
    return `<p class="tma-strip-doc__text-pair"${nodeAttr}>
      <span class="tma-strip-doc__text-strong">${esc(o.strong || '')}</span>
      <span class="tma-strip-doc__text-muted">${esc(o.muted || '')}</span>
    </p>`;
  }

  function renderPasswordField(opts) {
    const o = opts || {};
    const nodeId = o.nodeId || '';
    const nodeAttr = nodeId ? ` data-node-id="${esc(nodeId)}"` : '';
    const placeholder = o.placeholder || 'Password';
    return `<div class="tma-strip-doc__password"${nodeAttr}>
      <input type="password" class="tma-strip-doc__password-input" placeholder="${esc(placeholder)}" aria-label="${esc(placeholder)}">
      <span class="tma-strip-doc__password-icon" aria-hidden="true">${svg('EyeSlash16', 'tma-strip-doc__password-icon-svg', 16, 16)}</span>
    </div>`;
  }

  function renderCaption(opts) {
    const o = opts || {};
    const nodeId = o.nodeId || '';
    const nodeAttr = nodeId ? ` data-node-id="${esc(nodeId)}"` : '';
    return `<p class="tma-strip-doc__caption"${nodeAttr}>${esc(o.text || '')}</p>`;
  }

  function renderChartLabels(opts) {
    const o = opts || {};
    const nodeId = o.nodeId || '';
    const nodeAttr = nodeId ? ` data-node-id="${esc(nodeId)}"` : '';
    const labels = o.labels || [];
    const items = labels.map((label) => `<span class="tma-strip-doc__chart-label">${esc(label)}</span>`).join('');
    return `<div class="tma-strip-doc__chart-labels"${nodeAttr}>${items}</div>`;
  }

  function renderProgressExample() {
    return `<div class="tma-strip-doc__example-block" data-node-id="32421:48413">
      <p class="tma-strip-doc__example-label" data-node-id="32421:48414">Draw bar progress bar using Strip</p>
      <div class="tma-strip-doc__example-stack tma-strip-doc__example-stack--progress" data-node-id="32421:48415">
        ${renderTextPair({ nodeId: '32421:48416', strong: 'Users', muted: '86 of 100 Used' })}
        ${renderStrip({
          nodeId: '32421:48417',
          width: 600,
          height: 8,
          track: true,
          paddingRight: 240,
          segments: ['indigo', 'black', 'black', 'black', 'black', 'black', 'black'],
        })}
      </div>
    </div>`;
  }

  function renderPasswordExample() {
    return `<div class="tma-strip-doc__example-block" data-node-id="32421:48418">
      <p class="tma-strip-doc__example-label" data-node-id="32421:48419">Draw password strength indicator using Strip</p>
      <div class="tma-strip-doc__example-stack tma-strip-doc__example-stack--password" data-node-id="32421:48420">
        ${renderPasswordField({ nodeId: '32421:48421' })}
        ${renderStrip({
          nodeId: '32421:48422',
          width: 384,
          height: 4,
          segments: ['muted', 'muted', 'muted', 'muted'],
        })}
        ${renderCaption({
          nodeId: '32421:48423',
          text: 'Use 8 or more characters with a mix of letters, numbers & symbols.',
        })}
      </div>
    </div>`;
  }

  function renderBarChartExample() {
    const bars = [
      { nodeId: '32421:48429', paddingRight: 0, color: 'muted' },
      { nodeId: '32421:48430', paddingRight: 40, color: 'muted' },
      { nodeId: '32421:48431', paddingRight: 15, color: 'black' },
      { nodeId: '32421:48432', paddingRight: 45, color: 'muted' },
      { nodeId: '32421:48433', paddingRight: 20, color: 'muted' },
      { nodeId: '32421:48434', paddingRight: 40, color: 'muted' },
      { nodeId: '32421:48435', paddingRight: 30, color: 'muted' },
    ];

    const barsHtml = bars.map((bar) => renderStrip({
      nodeId: bar.nodeId,
      bar: true,
      paddingRight: bar.paddingRight,
      segments: [bar.color],
    })).join('');

    return `<div class="tma-strip-doc__example-block" data-node-id="32421:48424">
      <p class="tma-strip-doc__example-label" data-node-id="32421:48425">Draw bar chart using Strip</p>
      <div class="tma-strip-doc__chart" data-node-id="32421:48426">
        ${renderChartLabels({
          nodeId: '32421:48427',
          labels: ['Google', 'YouTube', 'Instagram', 'Pinterest', 'Facebook', 'Twitter', 'Tumblr'],
        })}
        <div class="tma-strip-doc__chart-bars" data-node-id="32421:48428">${barsHtml}</div>
      </div>
    </div>`;
  }

  function renderExamples() {
    return `${renderProgressExample()}${renderPasswordExample()}${renderBarChartExample()}`;
  }

  function renderDocumentationFooter(socialSvg) {
    const ts = socialSvg || (() => '');
    return `<footer class="tma-strip-doc__footer" data-node-id="32421:48436">
      <div class="tma-strip-doc__footer-brand">
        <div class="tma-strip-doc__logo" aria-hidden="true">
          ${ts('TMALogoMark', 'tma-strip-doc__logo-icon', 28, 28)}
          <span class="tma-strip-doc__wordmark">
            ${ts('TMALogoWordmark', 'tma-strip-doc__wordmark-left', 53, 12)}
            ${ts('TMALogoSuffix', 'tma-strip-doc__wordmark-right', 15, 12)}
          </span>
        </div>
        <p class="tma-strip-doc__copyright">© 2026 TM ANTOINE Advisory. All rights reserved.</p>
      </div>
      <div class="tma-strip-doc__socials">
        <a class="tma-strip-doc__social" href="https://twitter.com/FarewelltoWind" target="_blank" rel="noopener noreferrer" aria-label="Twitter">${ts('TwitterSocial', '', 28, 28)}</a>
        <a class="tma-strip-doc__social" href="https://www.instagram.com/farewelltowind" target="_blank" rel="noopener noreferrer" aria-label="Instagram">${ts('InstagramSocial', '', 28, 28)}</a>
        <a class="tma-strip-doc__social" href="https://www.threads.net/@farewelltowind" target="_blank" rel="noopener noreferrer" aria-label="Threads">${ts('ThreadsLogo', '', 28, 28)}</a>
        <a class="tma-strip-doc__social" href="https://dribbble.com/byewind" target="_blank" rel="noopener noreferrer" aria-label="Dribbble">${ts('DribbbleSocial', '', 28, 28)}</a>
        <a class="tma-strip-doc__social" href="https://www.behance.net/ByeWind" target="_blank" rel="noopener noreferrer" aria-label="Behance">${ts('BehanceSocial', '', 28, 28)}</a>
        <a class="tma-strip-doc__social" href="https://www.figma.com/@byewind" target="_blank" rel="noopener noreferrer" aria-label="Figma">${ts('FigmaSocial', '', 28, 28)}</a>
        <a class="tma-strip-doc__social" href="#" target="_blank" rel="noopener noreferrer" aria-label="Website">${ts('TMALogoMark', '', 28, 28)}</a>
      </div>
    </footer>`;
  }

  function mountDocumentation(opts) {
    const o = opts || {};
    if (o.examplesEl) o.examplesEl.innerHTML = renderExamples();
    if (o.footerEl && o.socialSvg) o.footerEl.innerHTML = renderDocumentationFooter(o.socialSvg);
  }

  window.TMAStrip = {
    renderStrip,
    renderTextPair,
    renderPasswordField,
    renderCaption,
    renderChartLabels,
    renderExamples,
    renderDocumentationFooter,
    mountDocumentation,
  };
})();
