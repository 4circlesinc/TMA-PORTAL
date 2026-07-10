/* TMA — Frame documentation (Figma 33302:2140) */
(function () {
  'use strict';

  function fi(key, cls, w, h) {
    const sources = [
      window.TMAFrameDocIcons,
      window.TMACardIcons,
      window.TMAButtonDocIcons,
      window.TMALineIcons,
      window.TMATableSearchIcons,
      window.TMAPopoverIcons,
      window.TMAButtonInstancesIcons,
      window.TMADatePickerIcons,
    ];
    for (let i = 0; i < sources.length; i += 1) {
      if (sources[i] && sources[i].svg) {
        const result = sources[i].svg(key, cls, w, h);
        if (result) return result;
      }
    }
    return '';
  }

  function esc(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function imagesBase(subpath) {
    if (typeof location === 'undefined') return `../images/${subpath}`;
    const segments = (location.pathname || '').split('/').filter(Boolean);
    if (segments.length && /\.[a-z0-9]+$/i.test(segments[segments.length - 1])) segments.pop();
    if (segments.length === 0) return `images/${subpath}`;
    return `${'../'.repeat(segments.length)}images/${subpath}`;
  }

  function localImg(relativePath, cls, w, h) {
    const src = imagesBase(relativePath);
    const size = `width:${w}px;height:${h}px`;
    return `<img class="${cls || ''}" src="${esc(src)}" alt="" style="${size};object-fit:cover" />`;
  }

  function place(x, y, w, h, html, nodeId) {
    const size = [
      w != null ? `width:${w}px;` : '',
      h != null ? `height:${h}px;` : '',
    ].join('');
    return `<div class="tma-frame-doc__node" style="left:${x}px;top:${y}px;${size}" data-node-id="${esc(nodeId)}">${html}</div>`;
  }

  function renderConnector(nodeId) {
    return `<svg class="tma-frame-doc__connector" width="40" height="8" viewBox="0 0 40 8" aria-hidden="true"${nodeId ? ` data-node-id="${esc(nodeId)}"` : ''}>
      <line x1="0" y1="4" x2="32" y2="4" stroke="rgba(0,0,0,0.2)" stroke-width="2"/>
      <path d="M32 1 L38 4 L32 7 Z" fill="rgba(0,0,0,0.2)"/>
    </svg>`;
  }

  function renderBadge(count, nodeId) {
    return `<span class="tma-frame-doc__badge"${nodeId ? ` data-node-id="${esc(nodeId)}"` : ''}>${esc(count)}</span>`;
  }

  function renderAvatar24(nodeId) {
    return `<span class="tma-frame-doc__avatar"${nodeId ? ` data-node-id="${esc(nodeId)}"` : ''}>
      ${localImg('avatars/AvatarByewind.png', 'tma-frame-doc__avatar-img', 24, 24)}
    </span>`;
  }

  function renderFolderIcon24(duotone, nodeId) {
    const key = duotone ? 'FolderNotchDuotone24' : 'FolderNotch24';
    return `<span class="tma-frame-doc__icon"${nodeId ? ` data-node-id="${esc(nodeId)}"` : ''}>
      ${fi(key, 'tma-frame-doc__icon-svg', 24, 24)}
    </span>`;
  }

  function renderSnowLogo40(nodeId) {
    return `<span class="tma-frame-doc__logo-icon"${nodeId ? ` data-node-id="${esc(nodeId)}"` : ''}>
      ${fi('SnowLogo40', 'tma-frame-doc__logo-icon-svg', 40, 40)}
    </span>`;
  }

  function renderTextBlock(opts) {
    const o = opts || {};
    const subtitle = o.subtitle
      ? `<span class="tma-frame-doc__text-sub">${esc(o.subtitle)}</span>`
      : '';
    const titleClass = o.titleSemibold ? ' tma-frame-doc__text-title--semibold' : '';
    return `<span class="tma-frame-doc__text-block"${o.nodeId ? ` data-node-id="${esc(o.nodeId)}"` : ''}>
      <span class="tma-frame-doc__text-title${titleClass}">${esc(o.title)}</span>
      ${subtitle}
    </span>`;
  }

  function renderProjectsIconText(duotone) {
    return `<div class="tma-frame-doc__icon-text tma-frame-doc__icon-text--inline">
      ${renderFolderIcon24(duotone)}
      ${renderTextBlock({ title: 'Projects' })}
    </div>`;
  }

  function renderIconTextProjects(nodeId) {
    return `<div class="tma-frame-doc__chip tma-frame-doc__chip--light" data-node-id="${esc(nodeId)}">
      ${renderFolderIcon24(true)}
      ${renderTextBlock({ title: 'Projects' })}
    </div>`;
  }

  function renderFrameProjects(nodeId, withArrow) {
    if (withArrow) {
      return `<div class="tma-frame-doc__chip tma-frame-doc__chip--light tma-frame-doc__chip--extended" data-node-id="${esc(nodeId)}">
        ${renderProjectsIconText(false)}
        <span class="tma-frame-doc__icon">${fi('ArrowLineRight20', 'tma-frame-doc__icon-svg', 20, 20)}</span>
      </div>`;
    }
    return `<div class="tma-frame-doc__chip tma-frame-doc__chip--light tma-frame-doc__chip--projects" data-node-id="${esc(nodeId)}">
      ${renderFolderIcon24(true)}
      ${renderTextBlock({ title: 'Projects' })}
    </div>`;
  }

  function renderByewindIconText() {
    return `<div class="tma-frame-doc__icon-text tma-frame-doc__icon-text--inline">
      ${renderAvatar24()}
      ${renderTextBlock({ title: 'ByeWind' })}
    </div>`;
  }

  function renderIconTextByewind(nodeId) {
    return `<div class="tma-frame-doc__chip tma-frame-doc__chip--grey" data-node-id="${esc(nodeId)}">
      ${renderAvatar24()}
      ${renderTextBlock({ title: 'ByeWind' })}
    </div>`;
  }

  function renderFrameByewind(nodeId, withBadge) {
    if (withBadge) {
      return `<div class="tma-frame-doc__chip tma-frame-doc__chip--grey tma-frame-doc__chip--extended" data-node-id="${esc(nodeId)}">
        ${renderByewindIconText()}
        ${renderBadge('12')}
      </div>`;
    }
    return `<div class="tma-frame-doc__chip tma-frame-doc__chip--grey" data-node-id="${esc(nodeId)}">
      ${renderAvatar24()}
      ${renderTextBlock({ title: 'ByeWind' })}
    </div>`;
  }

  function renderMessageIconText() {
    return `<div class="tma-frame-doc__icon-text">
      ${renderAvatar24()}
      ${renderTextBlock({ title: 'ByeWind', subtitle: 'Are you free tonight?' })}
    </div>`;
  }

  function renderIconTextMessage(nodeId) {
    return `<div class="tma-frame-doc__chip tma-frame-doc__chip--grey tma-frame-doc__chip--message" data-node-id="${esc(nodeId)}">
      ${renderMessageIconText()}
    </div>`;
  }

  function renderFrameMessage(nodeId, extended) {
    if (extended) {
      return `<div class="tma-frame-doc__chip tma-frame-doc__chip--grey tma-frame-doc__chip--message tma-frame-doc__chip--message-extended" data-node-id="${esc(nodeId)}">
        ${renderMessageIconText()}
        <div class="tma-frame-doc__message-group">
          <span class="tma-frame-doc__message-time">19:28</span>
          ${renderBadge('12')}
        </div>
      </div>`;
    }
    return `<div class="tma-frame-doc__chip tma-frame-doc__chip--grey tma-frame-doc__chip--message" data-node-id="${esc(nodeId)}">
      ${renderAvatar24()}
      ${renderTextBlock({ title: 'ByeWind', subtitle: 'Are you free tonight?' })}
    </div>`;
  }

  function renderExtensibilityCompare() {
    const parts = [`<div class="tma-frame-doc__compare" data-node-id="33302:2157">`];

    parts.push(place(0, 0, 200, 20, '<p class="tma-frame-doc__caption">Instance made using IconText.</p>', '33302:2161'));
    parts.push(place(323, 0, 197, 20, '<p class="tma-frame-doc__caption">Make the same instance with Frame.</p>', '33302:2162'));
    parts.push(place(646, 0, 208, 40, '<p class="tma-frame-doc__caption">Use the layout structure provided by Frame to add more functions to the instance.</p>', '33302:2163'));

    parts.push(place(0, 80, 200, null, renderIconTextProjects('33302:2166'), '33302:2166'));
    parts.push(place(320, 80, 200, null, renderFrameProjects('33302:2165', false), '33302:2165'));
    parts.push(place(640, 80, 200, null, renderFrameProjects('33302:2164', true), '33302:2164'));
    parts.push(place(240, 104, 40, 8, renderConnector('33302:2169'), '33302:2169'));
    parts.push(place(560, 104, 40, 8, renderConnector('33302:2171'), '33302:2171'));

    parts.push(place(0, 148, 200, 54, renderIconTextByewind('33302:2158'), '33302:2158'));
    parts.push(place(320, 148, 200, 54, renderFrameByewind('33302:2159', false), '33302:2159'));
    parts.push(place(640, 148, 200, 54, renderFrameByewind('33302:2160', true), '33302:2160'));
    parts.push(place(240, 175, 40, 8, renderConnector('33302:2167'), '33302:2167'));
    parts.push(place(560, 175, 40, 8, renderConnector('33302:2168'), '33302:2168'));

    parts.push(place(0, 222, 200, null, renderIconTextMessage('33302:2175'), '33302:2175'));
    parts.push(place(320, 222, 200, null, renderFrameMessage('33302:2174', false), '33302:2174'));
    parts.push(place(640, 222, 200, null, renderFrameMessage('33302:2173', true), '33302:2173'));
    parts.push(place(240, 249, 40, 8, renderConnector('33302:2170'), '33302:2170'));
    parts.push(place(560, 249, 40, 8, renderConnector('33302:2172'), '33302:2172'));

    parts.push('</div>');
    return parts.join('');
  }

  function renderSnowCopy() {
    return renderTextBlock({
      title: 'TMA',
      subtitle: 'A design system and UI kit.',
      titleSemibold: true,
    });
  }

  function renderLayoutCompare() {
    const parts = [`<div class="tma-frame-doc__layout-compare" data-node-id="33302:2179">`];

    parts.push(place(0, 0, 120, 20, '<p class="tma-frame-doc__caption">Standalone</p>', '33302:2188'));
    parts.push(place(160, 0, 120, 20, '<p class="tma-frame-doc__caption">Horizontal</p>', '33302:2187'));
    parts.push(place(474, 0, 140, 20, '<p class="tma-frame-doc__caption">Horizontal, Flip</p>', '33302:2189'));
    parts.push(place(788, 0, 120, 20, '<p class="tma-frame-doc__caption">Vertical</p>', '33302:2190'));

    parts.push(place(0, 61, null, null, `<div class="tma-frame-doc__chip tma-frame-doc__chip--grey tma-frame-doc__chip--layout tma-frame-doc__chip--standalone" data-node-id="33302:2181">${renderSnowLogo40()}</div>`, '33302:2181'));

    parts.push(place(157, 61, null, null, `<div class="tma-frame-doc__chip tma-frame-doc__chip--grey tma-frame-doc__chip--layout tma-frame-doc__chip--horizontal" data-node-id="33302:2180">${renderSnowLogo40()}${renderSnowCopy()}</div>`, '33302:2180'));

    parts.push(place(468, 61, null, null, `<div class="tma-frame-doc__chip tma-frame-doc__chip--grey tma-frame-doc__chip--layout tma-frame-doc__chip--horizontal tma-frame-doc__chip--flip" data-node-id="33302:2183">${renderSnowCopy()}${renderSnowLogo40()}</div>`, '33302:2183'));

    parts.push(place(779, 40, null, null, `<div class="tma-frame-doc__chip tma-frame-doc__chip--grey tma-frame-doc__chip--layout tma-frame-doc__chip--vertical" data-node-id="33302:2182">${renderSnowLogo40()}${renderSnowCopy()}</div>`, '33302:2182'));

    parts.push(place(97, 93, 40, 8, renderConnector('33302:2185'), '33302:2185'));
    parts.push(place(408, 93, 40, 8, renderConnector('33302:2184'), '33302:2184'));
    parts.push(place(719, 93, 40, 8, renderConnector('33302:2186'), '33302:2186'));

    parts.push('</div>');
    return parts.join('');
  }

  function renderExamples() {
    return `<div class="tma-frame-doc__examples-stack" data-node-id="33302:2153">
      <div class="tma-frame-doc__example-intro" data-node-id="33302:2154">
        <h3 class="tma-frame-doc__example-heading" data-node-id="33302:2155">The Frame component will be more extensible than IconText.</h3>
        <p class="tma-frame-doc__example-copy" data-node-id="33302:2156">In the following example I will use Frame instead of IconText to make the same instance.</p>
      </div>
      ${renderExtensibilityCompare()}
      <div class="tma-frame-doc__example-note" data-node-id="33302:2176">
        <p>When Frame and IconText are the same instance, the layer structure of Frame will be more complex, but the extensibility will be retained.</p>
        <p>Therefore, designers need to consider when to use Frame and when to use IconText.</p>
      </div>
    </div>
    <div class="tma-frame-doc__example-section" data-node-id="33302:2177">
      <h3 class="tma-frame-doc__example-heading" data-node-id="33302:2178">Using Frame makes it easier to change the layout structure of an instance.</h3>
      ${renderLayoutCompare()}
    </div>`;
  }

  function renderDocumentationFooter(socialSvg) {
    const ts = socialSvg || (() => '');
    return `<footer class="tma-frame-doc__footer" data-node-id="33302:2191">
      <div class="tma-frame-doc__footer-brand">
        <div class="tma-frame-doc__logo" aria-hidden="true">
          ${ts('TMALogoMark', 'tma-frame-doc__logo-icon', 28, 28)}
          <span class="tma-frame-doc__wordmark">
            ${ts('TMALogoWordmark', 'tma-frame-doc__wordmark-left', 53, 12)}
            ${ts('TMALogoSuffix', 'tma-frame-doc__wordmark-right', 15, 12)}
          </span>
        </div>
        <p class="tma-frame-doc__copyright">© 2026 TM ANTOINE Advisory. All rights reserved.</p>
      </div>
      <div class="tma-frame-doc__socials">
        <a class="tma-frame-doc__social-link" href="https://twitter.com/FarewelltoWind" target="_blank" rel="noopener noreferrer" aria-label="Twitter">${ts('TwitterSocial', '', 28, 28)}</a>
        <a class="tma-frame-doc__social-link" href="https://www.instagram.com/farewelltowind" target="_blank" rel="noopener noreferrer" aria-label="Instagram">${ts('InstagramSocial', '', 28, 28)}</a>
        <a class="tma-frame-doc__social-link" href="https://www.threads.net/@farewelltowind" target="_blank" rel="noopener noreferrer" aria-label="Threads">${ts('ThreadsLogo', '', 28, 28)}</a>
        <a class="tma-frame-doc__social-link" href="https://dribbble.com/byewind" target="_blank" rel="noopener noreferrer" aria-label="Dribbble">${ts('DribbbleSocial', '', 28, 28)}</a>
        <a class="tma-frame-doc__social-link" href="https://www.behance.net/ByeWind" target="_blank" rel="noopener noreferrer" aria-label="Behance">${ts('BehanceSocial', '', 28, 28)}</a>
        <a class="tma-frame-doc__social-link" href="https://www.figma.com/@byewind" target="_blank" rel="noopener noreferrer" aria-label="Figma">${ts('FigmaSocial', '', 28, 28)}</a>
        <a class="tma-frame-doc__social-link" href="#" target="_blank" rel="noopener noreferrer" aria-label="Website">${ts('TMALogoMark', '', 28, 28)}</a>
      </div>
    </footer>`;
  }

  function mountDocumentation(opts) {
    const o = opts || {};
    if (o.examplesEl) o.examplesEl.innerHTML = renderExamples();
    if (o.footerEl && o.socialSvg) o.footerEl.innerHTML = renderDocumentationFooter(o.socialSvg);
  }

  window.TMAFrameDoc = {
    renderExamples,
    renderDocumentationFooter,
    mountDocumentation,
  };
})();
