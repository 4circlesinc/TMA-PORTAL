/* TMA — Badge component (Figma 32792:840) */
(function () {
  'use strict';

  const svg = (key, cls, w, h) => (window.TMABadgeIcons && window.TMABadgeIcons.svg(key, cls, w, h)) || '';

  function esc(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderBadge(opts) {
    const o = opts || {};
    const type = o.type || 'number';
    const nodeId = o.nodeId || '';
    const nodeAttr = nodeId ? ` data-node-id="${esc(nodeId)}"` : '';
    const color = o.color || 'indigo';
    const value = o.value || '';
    const offset = o.offset || '';
    const offsetClass = offset && offset !== 'none' ? ` tma-badge--offset-${esc(offset)}` : '';

    if (type === 'dot') {
      const dotColor = o.dotColor || color;
      return `<span class="tma-badge tma-badge--dot tma-badge--${esc(dotColor)}${offsetClass}"${nodeAttr} aria-hidden="true">
        <span class="tma-badge__dot">${svg('BadgeDot6', 'tma-badge__dot-svg', 6, 6)}</span>
      </span>`;
    }

    return `<span class="tma-badge tma-badge--number tma-badge--${esc(color)}${offsetClass}"${nodeAttr}>
      <span class="tma-badge__label">${esc(value)}</span>
    </span>`;
  }

  function renderIconSlot(opts) {
    const o = opts || {};
    const nodeId = o.nodeId || '';
    const nodeAttr = nodeId ? ` data-node-id="${esc(nodeId)}"` : '';
    const iconKey = o.icon || 'Sun20Duotone';
    const badge = o.badge || null;
    const size = o.size || 20;
    const badgeHtml = badge ? renderBadge({ ...badge, offset: badge.offset || 'icon' }) : '';

    return `<span class="tma-badge-icon"${nodeAttr}>
      <span class="tma-badge-icon__glyph">${svg(iconKey, 'tma-badge-icon__svg', size, size)}</span>
      ${badgeHtml}
    </span>`;
  }

  function renderToolbarButton(opts) {
    const o = opts || {};
    const nodeId = o.nodeId || '';
    const nodeAttr = nodeId ? ` data-node-id="${esc(nodeId)}"` : '';
    const iconKey = o.icon || 'Sun20Duotone';
    const badge = o.badge || null;

    return `<button type="button" class="tma-badge-doc__toolbar-btn"${nodeAttr} aria-hidden="true" tabindex="-1">
      ${renderIconSlot({ icon: iconKey, badge, nodeId: o.iconNodeId })}
    </button>`;
  }

  function renderIconGroup(opts) {
    const o = opts || {};
    const nodeId = o.nodeId || '';
    const nodeAttr = nodeId ? ` data-node-id="${esc(nodeId)}"` : '';
    const badgeColor = o.badgeColor || 'indigo';
    const buttons = o.buttons || [
      { icon: 'Sun20Duotone', nodeId: 'I32726:1938;10922:14236' },
      { icon: 'ClockCounterClockwise20Duotone', nodeId: 'I32726:1938;10922:14260' },
      { icon: 'Bell20Duotone', nodeId: 'I32726:1938;10922:14268', badge: { type: 'number', value: '12', color: badgeColor, nodeId: 'I32726:1938;10922:14268;37892:156979;12119:14138' } },
      { icon: 'Sidebar20Duotone', nodeId: 'I32726:1938;10922:14276' },
    ];

    const html = buttons.map((btn) => renderToolbarButton({
      nodeId: btn.nodeId,
      icon: btn.icon,
      badge: btn.badge,
      iconNodeId: btn.iconNodeId,
    })).join('');

    return `<div class="tma-badge-doc__icon-group"${nodeAttr}>${html}</div>`;
  }

  function renderAvatarIcon(opts) {
    const o = opts || {};
    const nodeId = o.nodeId || '';
    const nodeAttr = nodeId ? ` data-node-id="${esc(nodeId)}"` : '';
    const badge = o.badge || null;
    const src = o.src || '../images/avatars/AvatarByewind.png';
    const badgeHtml = badge ? renderBadge({ ...badge, offset: badge.offset || 'avatar' }) : '';

    return `<span class="tma-badge-avatar-icon"${nodeAttr}>
      <img class="tma-badge-avatar-icon__image" src="${esc(src)}" alt="" width="24" height="24" />
      ${badgeHtml}
    </span>`;
  }

  function renderAssetsButton(opts) {
    const o = opts || {};
    const nodeId = o.nodeId || '32726:1947';
    const nodeAttr = nodeId ? ` data-node-id="${esc(nodeId)}"` : '';

    return `<button type="button" class="tma-badge-doc__assets-btn"${nodeAttr} aria-hidden="true" tabindex="-1">
      <span class="tma-badge-doc__assets-label" data-node-id="I32726:1947;16508:107671;10892:2493">Assets</span>
      <span class="tma-badge-doc__assets-icon" data-node-id="I32726:1947;11022:8264">
        <span class="tma-badge-doc__assets-icon-slot" data-node-id="I32726:1947;11022:8264;12119:14091"></span>
        ${renderBadge({ type: 'dot', dotColor: 'indigo', offset: 'button', nodeId: 'I32726:1947;11022:8264;12119:14136' })}
      </span>
    </button>`;
  }

  function renderExamples() {
    return `<div class="tma-badge-doc__example-block tma-badge-doc__example-block--colors" data-node-id="32726:1936">
      <p class="tma-badge-doc__example-caption" data-node-id="32726:1937">Can change the color and style of the Badge.</p>
      ${renderIconGroup({ nodeId: '32726:1938', badgeColor: 'indigo' })}
      ${renderIconGroup({ nodeId: '32726:1939', badgeColor: 'red' })}
    </div>
    <div class="tma-badge-doc__example-block" data-node-id="32726:1940">
      <p class="tma-badge-doc__example-caption" data-node-id="32726:1941">Can use different Badge styles for the same type of information.</p>
      <div class="tma-badge-doc__avatar-row" data-node-id="32726:1942">
        ${renderAvatarIcon({
          nodeId: '32726:1943',
          badge: { type: 'dot', dotColor: 'indigo', nodeId: 'I32726:1943;12119:14140' },
        })}
        ${renderAvatarIcon({
          nodeId: '32726:1944',
          badge: { type: 'number', value: '99+', color: 'indigo', nodeId: 'I32726:1944;12119:14140' },
        })}
      </div>
    </div>
    <div class="tma-badge-doc__example-block" data-node-id="32726:1945">
      <p class="tma-badge-doc__example-caption" data-node-id="32726:1946">Add a Badge to the button via the Icon component.</p>
      ${renderAssetsButton()}
    </div>`;
  }

  function renderDocumentationFooter(socialSvg) {
    const ts = socialSvg || (() => '');
    return `<footer class="tma-badge-doc__footer" data-node-id="32726:1948">
      <div class="tma-badge-doc__footer-brand">
        <div class="tma-badge-doc__logo" aria-hidden="true">
          ${ts('TMALogoMark', 'tma-badge-doc__logo-icon', 28, 28)}
          <span class="tma-badge-doc__wordmark">
            ${ts('TMALogoWordmark', 'tma-badge-doc__wordmark-left', 53, 12)}
            ${ts('TMALogoSuffix', 'tma-badge-doc__wordmark-right', 15, 12)}
          </span>
        </div>
        <p class="tma-badge-doc__copyright">© 2026 TM ANTOINE Advisory. All rights reserved.</p>
      </div>
      <div class="tma-badge-doc__socials">
        <a class="tma-badge-doc__social" href="https://twitter.com/FarewelltoWind" target="_blank" rel="noopener noreferrer" aria-label="Twitter">${ts('TwitterSocial', '', 28, 28)}</a>
        <a class="tma-badge-doc__social" href="https://www.instagram.com/farewelltowind" target="_blank" rel="noopener noreferrer" aria-label="Instagram">${ts('InstagramSocial', '', 28, 28)}</a>
        <a class="tma-badge-doc__social" href="https://www.threads.net/@farewelltowind" target="_blank" rel="noopener noreferrer" aria-label="Threads">${ts('ThreadsLogo', '', 28, 28)}</a>
        <a class="tma-badge-doc__social" href="https://dribbble.com/byewind" target="_blank" rel="noopener noreferrer" aria-label="Dribbble">${ts('DribbbleSocial', '', 28, 28)}</a>
        <a class="tma-badge-doc__social" href="https://www.behance.net/ByeWind" target="_blank" rel="noopener noreferrer" aria-label="Behance">${ts('BehanceSocial', '', 28, 28)}</a>
        <a class="tma-badge-doc__social" href="https://www.figma.com/@byewind" target="_blank" rel="noopener noreferrer" aria-label="Figma">${ts('FigmaSocial', '', 28, 28)}</a>
        <a class="tma-badge-doc__social" href="#" target="_blank" rel="noopener noreferrer" aria-label="Website">${ts('TMALogoMark', '', 28, 28)}</a>
      </div>
    </footer>`;
  }

  function mountDocumentation(opts) {
    const o = opts || {};
    if (o.examplesEl) o.examplesEl.innerHTML = renderExamples();
    if (o.footerEl && o.socialSvg) o.footerEl.innerHTML = renderDocumentationFooter(o.socialSvg);
  }

  window.TMABadge = {
    renderBadge,
    renderIconSlot,
    renderIconGroup,
    renderAvatarIcon,
    renderAssetsButton,
    renderExamples,
    renderDocumentationFooter,
    mountDocumentation,
  };
})();
