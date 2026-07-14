/* TMA - Tag component (Figma 33307:661) */
(function () {
  'use strict';

  const svg = (key, cls, w, h) => (window.TMATagIcons && window.TMATagIcons.svg(key, cls, w, h)) || '';

  function esc(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderTag(opts) {
    const o = opts || {};
    const nodeId = o.nodeId || '';
    const nodeAttr = nodeId ? ` data-node-id="${esc(nodeId)}"` : '';
    const label = o.label || 'Tag';
    const closeNodeId = o.closeNodeId || '';
    const closeAttr = closeNodeId ? ` data-node-id="${esc(closeNodeId)}"` : '';
    const removable = o.removable !== false;
    const iconCls = o.iconClass ? ` ${esc(o.iconClass)}` : '';
    const iconHtml = o.leftIcon
      ? `<span class="tma-tag__icon${iconCls}">${o.leftIcon}</span>`
      : '';
    const withIconCls = o.leftIcon ? ' tma-tag--with-icon' : '';

    let trailingHtml = '';
    if (o.rightIcon) {
      trailingHtml = `<span class="tma-tag__right">${o.rightIcon}</span>`;
    } else if (removable) {
      trailingHtml = `<button type="button" class="tma-tag__close"${closeAttr} aria-label="Remove ${esc(label)}">${svg('Close12', 'tma-tag__close-svg', 5.5, 5.5)}</button>`;
    }

    return `<span class="tma-tag${withIconCls}"${nodeAttr}>
      ${iconHtml}
      <span class="tma-tag__label">${esc(label)}</span>
      ${trailingHtml}
    </span>`;
  }

  function renderTagField(opts) {
    const o = opts || {};
    const nodeId = o.nodeId || '33307:776';
    const nodeAttr = nodeId ? ` data-node-id="${esc(nodeId)}"` : '';
    const title = o.title || 'Title';
    const tags = o.tags || [
      { label: 'List Item', nodeId: 'I33307:776;11029:21470;11048:14280', closeNodeId: 'I33307:776;11029:21470;11048:14280;11030:11401' },
      { label: 'Tag', nodeId: 'I33307:776;11029:21470;11048:14281', closeNodeId: 'I33307:776;11029:21470;11048:14281;11030:11401' },
    ];

    const tagsHtml = tags.map((tag) => renderTag({
      label: tag.label,
      nodeId: tag.nodeId,
      closeNodeId: tag.closeNodeId,
    })).join('');

    return `<div class="tma-tag-doc__field"${nodeAttr}>
      <span class="tma-tag-doc__field-title" data-node-id="I33307:776;11029:20908">${esc(title)}</span>
      <div class="tma-tag-doc__field-tags" data-node-id="I33307:776;11029:21470">${tagsHtml}</div>
    </div>`;
  }

  function renderExamples() {
    return renderTagField();
  }

  function renderDocumentationFooter(socialSvg) {
    const ts = socialSvg || (() => '');
    return `<footer class="tma-tag-doc__footer" data-node-id="33307:777">
      <div class="tma-tag-doc__footer-brand">
        <div class="tma-tag-doc__logo" aria-hidden="true">
          ${ts('TMALogoMark', 'tma-tag-doc__logo-icon', 28, 28)}
          <span class="tma-tag-doc__wordmark">
            ${ts('TMALogoWordmark', 'tma-tag-doc__wordmark-left', 53, 12)}
            ${ts('TMALogoSuffix', 'tma-tag-doc__wordmark-right', 15, 12)}
          </span>
        </div>
        <p class="tma-tag-doc__copyright">© 2026 TM ANTOINE Advisory. All rights reserved.</p>
      </div>
      <div class="tma-tag-doc__socials">
        <a class="tma-tag-doc__social" href="https://twitter.com/FarewelltoWind" target="_blank" rel="noopener noreferrer" aria-label="Twitter">${ts('TwitterSocial', '', 28, 28)}</a>
        <a class="tma-tag-doc__social" href="https://www.instagram.com/farewelltowind" target="_blank" rel="noopener noreferrer" aria-label="Instagram">${ts('InstagramSocial', '', 28, 28)}</a>
        <a class="tma-tag-doc__social" href="https://www.threads.net/@farewelltowind" target="_blank" rel="noopener noreferrer" aria-label="Threads">${ts('ThreadsLogo', '', 28, 28)}</a>
        <a class="tma-tag-doc__social" href="https://dribbble.com/byewind" target="_blank" rel="noopener noreferrer" aria-label="Dribbble">${ts('DribbbleSocial', '', 28, 28)}</a>
        <a class="tma-tag-doc__social" href="https://www.behance.net/ByeWind" target="_blank" rel="noopener noreferrer" aria-label="Behance">${ts('BehanceSocial', '', 28, 28)}</a>
        <a class="tma-tag-doc__social" href="https://www.figma.com/@byewind" target="_blank" rel="noopener noreferrer" aria-label="Figma">${ts('FigmaSocial', '', 28, 28)}</a>
        <a class="tma-tag-doc__social" href="#" target="_blank" rel="noopener noreferrer" aria-label="Website">${ts('TMALogoMark', '', 28, 28)}</a>
      </div>
    </footer>`;
  }

  function mountDocumentation(opts) {
    const o = opts || {};
    if (o.examplesEl) o.examplesEl.innerHTML = renderExamples();
    if (o.footerEl && o.socialSvg) o.footerEl.innerHTML = renderDocumentationFooter(o.socialSvg);
  }

  window.TMATag = {
    renderTag,
    renderTagField,
    renderExamples,
    renderDocumentationFooter,
    mountDocumentation,
  };
})();
