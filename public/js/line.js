/* TMA - Line component (Figma 32792:1923) */
(function () {
  'use strict';

  const lineSvg = (key, cls, w, h) => (window.TMALineIcons && window.TMALineIcons.svg(key, cls, w, h)) || '';
  const sharedSvg = (key, cls, w, h) => (window.TMATableSearchIcons && window.TMATableSearchIcons.svg(key, cls, w, h)) || '';

  function esc(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderLine(opts) {
    const o = opts || {};
    const nodeId = o.nodeId || '';
    const nodeAttr = nodeId ? ` data-node-id="${esc(nodeId)}"` : '';
    const variant = o.variant || 'horizontal';

    if (variant === 'vertical') {
      return `<span class="tma-line tma-line--vertical" role="separator" aria-hidden="true"${nodeAttr}></span>`;
    }

    if (variant === 'pill') {
      return `<span class="tma-line tma-line--pill-wrap"${nodeAttr}><span class="tma-line tma-line--pill"></span></span>`;
    }

    return `<span class="tma-line tma-line--horizontal" role="presentation"${nodeAttr}></span>`;
  }

  function renderTab(opts) {
    const o = opts || {};
    const active = o.active === true;
    const indicator = o.indicator || 'underline';
    const nodeId = o.nodeId || '';
    const nodeAttr = nodeId ? ` data-node-id="${esc(nodeId)}"` : '';
    const label = o.label || 'Text';
    const lineHtml = active ? renderLine({ variant: indicator, nodeId: o.lineNodeId }) : '';

    return `<div class="tma-line-doc__tab${active ? ' tma-line-doc__tab--active' : ''}"${nodeAttr}>
      <span class="tma-line-doc__tab-label">${esc(label)}</span>
      ${lineHtml}
    </div>`;
  }

  function renderTabGroup(opts) {
    const o = opts || {};
    const nodeId = o.nodeId || '';
    const nodeAttr = nodeId ? ` data-node-id="${esc(nodeId)}"` : '';
    const count = o.count || 7;
    const indicator = o.indicator || 'underline';
    const heightClass = indicator === 'underline' ? ' tma-line-doc__tab-group--h24' : '';
    const tabs = [];

    for (let i = 0; i < count; i += 1) {
      tabs.push(renderTab({
        active: i === 0,
        indicator,
        label: 'Text',
        nodeId: o.tabNodeIds && o.tabNodeIds[i],
        lineNodeId: i === 0 && o.lineNodeId ? o.lineNodeId : '',
      }));
    }

    return `<div class="tma-line-doc__tab-group${heightClass}"${nodeAttr}>${tabs.join('')}</div>`;
  }

  function renderIconButton(opts) {
    const o = opts || {};
    const nodeId = o.nodeId || '';
    const nodeAttr = nodeId ? ` data-node-id="${esc(nodeId)}"` : '';
    const iconKey = o.icon || '';
    const aria = o.ariaLabel || '';
    const ariaAttr = aria ? ` aria-label="${esc(aria)}"` : ' aria-hidden="true"';
    const wide = o.wide ? ' tma-line-doc__toolbar-btn--wide' : '';
    const chevron = o.chevron ? `<span class="tma-line-doc__toolbar-chevron">${lineSvg('ArrowLineDown16', 'tma-line-doc__toolbar-chevron-svg', 9, 5)}</span>` : '';

    return `<button type="button" class="tma-line-doc__toolbar-btn${wide}"${nodeAttr}${ariaAttr}>
      <span class="tma-line-doc__toolbar-icon">${lineSvg(iconKey, 'tma-line-doc__toolbar-icon-svg', 16, 16)}</span>
      ${chevron}
    </button>`;
  }

  function renderToolbar(opts) {
    const o = opts || {};
    const nodeId = o.nodeId || '32219:8451';
    const nodeAttr = nodeId ? ` data-node-id="${esc(nodeId)}"` : '';

    return `<div class="tma-line-doc__toolbar"${nodeAttr}>
      <div class="tma-line-doc__toolbar-group" data-node-id="32219:8452">
        ${renderIconButton({ nodeId: 'I32219:8452;10922:14518', icon: 'ArrowUUpLeft16', ariaLabel: 'Undo' })}
        ${renderIconButton({ nodeId: 'I32219:8452;10922:14519', icon: 'ArrowUUpRight16', ariaLabel: 'Redo' })}
      </div>
      ${renderLine({ variant: 'vertical', nodeId: '32219:8453' })}
      <div class="tma-line-doc__toolbar-group" data-node-id="32219:8454">
        ${renderIconButton({ nodeId: 'I32219:8454;10922:14518', icon: 'TextT16', wide: true, chevron: true, ariaLabel: 'Text style' })}
        ${renderIconButton({ nodeId: 'I32219:8454;10922:14519', icon: 'TextA16', wide: true, chevron: true, ariaLabel: 'Text color' })}
      </div>
      <div class="tma-line-doc__toolbar-group" data-node-id="32219:8455">
        ${renderIconButton({ nodeId: 'I32219:8455;12401:3557', icon: 'TextB16', ariaLabel: 'Bold' })}
        ${renderIconButton({ nodeId: 'I32219:8455;12401:3558', icon: 'TextItalic16', ariaLabel: 'Italic' })}
        ${renderIconButton({ nodeId: 'I32219:8455;12401:3559', icon: 'TextUnderline16', ariaLabel: 'Underline' })}
        ${renderIconButton({ nodeId: 'I32219:8455;12401:3560', icon: 'TextStrikethrough16', ariaLabel: 'Strikethrough' })}
        ${renderIconButton({ nodeId: 'I32219:8455;12401:3561', icon: 'ListBullets16', ariaLabel: 'Bulleted list' })}
      </div>
      ${renderLine({ variant: 'vertical', nodeId: '32219:8456' })}
      <div class="tma-line-doc__toolbar-group" data-node-id="32219:8457">
        ${renderIconButton({ nodeId: 'I32219:8457;10922:14518', icon: 'Link16', ariaLabel: 'Link' })}
        <button type="button" class="tma-line-doc__toolbar-btn" data-node-id="I32219:8457;10922:14519" aria-label="More options">
          <span class="tma-line-doc__toolbar-icon">${sharedSvg('ThreeDots16', 'tma-line-doc__toolbar-icon-svg', 16, 16)}</span>
        </button>
      </div>
      <button type="button" class="tma-line-doc__toolbar-expand" data-node-id="32219:8458" aria-label="Expand">
        <span class="tma-line-doc__toolbar-icon">${lineSvg('ArrowsOutSimple16', 'tma-line-doc__toolbar-icon-svg', 16, 16)}</span>
      </button>
    </div>`;
  }

  function renderUnderlineExample() {
    return `<div class="tma-line-doc__example-block" data-node-id="32219:8443">
      <p class="tma-line-doc__example-label" data-node-id="32219:8444">Draw an underline in the Tap component.</p>
      ${renderTabGroup({
        nodeId: '32219:8445',
        indicator: 'underline',
        lineNodeId: 'I32219:8445;12857:124054;12870:6573',
      })}
    </div>`;
  }

  function renderPillExample() {
    return `<div class="tma-line-doc__example-block" data-node-id="32219:8446">
      <p class="tma-line-doc__example-label" data-node-id="32219:8447">Using the Line component will allow you to adjust the style of the underline in the instance.</p>
      ${renderTabGroup({
        nodeId: '32219:8448',
        indicator: 'pill',
        lineNodeId: 'I32219:8448;12857:124054;12870:6573',
      })}
    </div>`;
  }

  function renderSeparatorExample() {
    return `<div class="tma-line-doc__example-block tma-line-doc__example-block--last" data-node-id="32219:8449">
      <p class="tma-line-doc__example-label" data-node-id="32219:8450">Use Line component as separator between components.</p>
      ${renderToolbar()}
    </div>`;
  }

  function renderExamples() {
    return `${renderUnderlineExample()}${renderPillExample()}${renderSeparatorExample()}`;
  }

  function renderDocumentationFooter(socialSvg) {
    const ts = socialSvg || (() => '');
    return `<footer class="tma-line-doc__footer" data-node-id="32219:8459">
      <div class="tma-line-doc__footer-brand">
        <div class="tma-line-doc__logo" aria-hidden="true">
          ${ts('TMALogoMark', 'tma-line-doc__logo-icon', 28, 28)}
          <span class="tma-line-doc__wordmark">
            ${ts('TMALogoWordmark', 'tma-line-doc__wordmark-left', 53, 12)}
            ${ts('TMALogoSuffix', 'tma-line-doc__wordmark-right', 15, 12)}
          </span>
        </div>
        <p class="tma-line-doc__copyright">© 2026 TM ANTOINE Advisory. All rights reserved.</p>
      </div>
      <div class="tma-line-doc__socials">
        <a class="tma-line-doc__social" href="https://twitter.com/FarewelltoWind" target="_blank" rel="noopener noreferrer" aria-label="Twitter">${ts('TwitterSocial', '', 28, 28)}</a>
        <a class="tma-line-doc__social" href="https://www.instagram.com/farewelltowind" target="_blank" rel="noopener noreferrer" aria-label="Instagram">${ts('InstagramSocial', '', 28, 28)}</a>
        <a class="tma-line-doc__social" href="https://www.threads.net/@farewelltowind" target="_blank" rel="noopener noreferrer" aria-label="Threads">${ts('ThreadsLogo', '', 28, 28)}</a>
        <a class="tma-line-doc__social" href="https://dribbble.com/byewind" target="_blank" rel="noopener noreferrer" aria-label="Dribbble">${ts('DribbbleSocial', '', 28, 28)}</a>
        <a class="tma-line-doc__social" href="https://www.behance.net/ByeWind" target="_blank" rel="noopener noreferrer" aria-label="Behance">${ts('BehanceSocial', '', 28, 28)}</a>
        <a class="tma-line-doc__social" href="https://www.figma.com/@byewind" target="_blank" rel="noopener noreferrer" aria-label="Figma">${ts('FigmaSocial', '', 28, 28)}</a>
        <a class="tma-line-doc__social" href="#" target="_blank" rel="noopener noreferrer" aria-label="Website">${ts('TMALogoMark', '', 28, 28)}</a>
      </div>
    </footer>`;
  }

  function mountDocumentation(opts) {
    const o = opts || {};
    if (o.examplesEl) o.examplesEl.innerHTML = renderExamples();
    if (o.footerEl && o.socialSvg) o.footerEl.innerHTML = renderDocumentationFooter(o.socialSvg);
  }

  window.TMALine = {
    renderLine,
    renderTab,
    renderTabGroup,
    renderToolbar,
    renderExamples,
    renderDocumentationFooter,
    mountDocumentation,
  };
})();
