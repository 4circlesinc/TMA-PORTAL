/* TMA — Text documentation (Figma 32722:4768) */
(function () {
  'use strict';

  function fi(key, cls, w, h) {
    const sources = [
      window.TMAFrameDocIcons,
      window.TMATableSearchIcons,
      window.TMAButtonInstancesIcons,
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
    return window.TMAText && window.TMAText.esc
      ? window.TMAText.esc(value)
      : String(value);
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

  function renderTextBlock(opts) {
    if (window.TMAText && window.TMAText.renderTextBlock) {
      return window.TMAText.renderTextBlock(opts);
    }
    const o = opts || {};
    const subtitle = o.subtitle
      ? `<span class="tma-frame-doc__text-sub">${esc(o.subtitle)}</span>`
      : '';
    return `<span class="tma-frame-doc__text-block">
      <span class="tma-frame-doc__text-title">${esc(o.title)}</span>
      ${subtitle}
    </span>`;
  }

  function renderSettingsRow(opts) {
    const o = opts || {};
    const subtitle = o.subtitle
      ? renderTextBlock({ title: o.title, subtitle: o.subtitle })
      : renderTextBlock({ title: o.title });
    return `<div class="tma-frame-doc__chip tma-frame-doc__chip--grey tma-frame-doc__chip--settings${o.tall ? ' tma-frame-doc__chip--settings-tall' : ''}" data-node-id="${esc(o.nodeId)}">
      ${subtitle}
      <span class="tma-frame-doc__icon">${fi('ArrowLineRight16', 'tma-frame-doc__icon-svg', 16, 16)}</span>
    </div>`;
  }

  function renderAvatar24() {
    return `<span class="tma-frame-doc__avatar">
      ${localImg('avatars/AvatarByewind.png', 'tma-frame-doc__avatar-img', 24, 24)}
    </span>`;
  }

  function renderAvatarRow(opts) {
    const o = opts || {};
    const block = o.subtitle
      ? renderTextBlock({ title: o.title, subtitle: o.subtitle, subtitleEllipsis: true })
      : renderTextBlock({ title: o.title });
    const tallCls = o.subtitle ? ' tma-text-doc__avatar-row--tall' : '';
    return `<div class="tma-frame-doc__chip tma-frame-doc__chip--grey tma-frame-doc__chip--avatar${tallCls}" data-node-id="${esc(o.nodeId)}">
      ${renderAvatar24()}
      ${block}
    </div>`;
  }

  function renderExamples() {
    return `<div class="tma-text-doc__examples-inner" data-node-id="32722:4778">
      <div class="tma-text-doc__block" data-node-id="32722:4780">
        <p class="tma-text-doc__hint" data-node-id="32722:4781">If there is one line of text in the component, or if there are two lines of text, our previous approach was to create multiple variants of the component. As in the example below.</p>
        <div class="tma-text-doc__example-frame tma-text-doc__example-frame--variants" data-node-id="32722:4782">
          <div class="tma-text-doc__variant-group">
            <p class="tma-text-doc__variant-label" data-node-id="32722:4785">Variant 1:</p>
            ${renderSettingsRow({ title: 'Email', nodeId: '32722:4783' })}
          </div>
          <div class="tma-text-doc__variant-group">
            <p class="tma-text-doc__variant-label tma-text-doc__variant-label--v2" data-node-id="32722:4786">Variant 2:</p>
            ${renderSettingsRow({
            title: 'Password',
            subtitle: 'Set a permanent password to login to your account.',
            tall: true,
            nodeId: '32722:4784',
          })}
          </div>
        </div>
      </div>
      <div class="tma-text-doc__block" data-node-id="32722:4787">
        <p class="tma-text-doc__hint" data-node-id="32722:4788">Now, if we replace the text with a text component, we won't need to add more variants to the component. We only need to change the Text instance in the instance to change the text to two lines.</p>
        <div class="tma-text-doc__example-frame tma-text-doc__example-frame--single" data-node-id="32722:4789">
          <div class="tma-text-doc__variant-group">
            <p class="tma-text-doc__variant-label" data-node-id="32722:4792">One component, one variant:</p>
            ${renderSettingsRow({ title: 'Email', nodeId: '32722:4790' })}
          </div>
          <div class="tma-text-doc__variant-group tma-text-doc__variant-group--compact">
            ${renderSettingsRow({
            title: 'Password',
            subtitle: 'Set a permanent password to login to your account.',
            tall: true,
            nodeId: '32722:4791',
          })}
          </div>
        </div>
      </div>
      <div class="tma-text-doc__block" data-node-id="32722:4793">
        <div class="tma-text-doc__hint" data-node-id="32722:4794">
          <p>The combination of avatar and name is very common, such as sidebars and chat interfaces.</p>
          <p>Now we can complete both designs without adding variants.</p>
        </div>
        <div class="tma-text-doc__avatar-stack" data-node-id="32722:4795">
          ${renderAvatarRow({ title: 'ByeWind', nodeId: '32722:4796' })}
          ${renderAvatarRow({
            title: 'ByeWind',
            subtitle: 'Are you free tonight?',
            nodeId: '32722:4797',
          })}
        </div>
      </div>
    </div>`;
  }

  function mountDocumentation(opts) {
    const o = opts || {};
    if (o.examplesEl) {
      o.examplesEl.innerHTML = renderExamples();
    }
    if (o.footerEl && window.TMAFrameDoc && window.TMAFrameDoc.renderDocumentationFooter) {
      o.footerEl.innerHTML = window.TMAFrameDoc.renderDocumentationFooter(o.socialSvg);
    }
  }

  window.TMATextDoc = {
    renderExamples,
    mountDocumentation,
  };
})();
