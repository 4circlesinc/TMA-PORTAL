/* TMA - IconText documentation (Figma 33302:488) */
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
      window.TMAInputIcons,
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

  function renderTextBlock(opts) {
    const o = opts || {};
    const subtitle = o.subtitle
      ? `<span class="tma-frame-doc__text-sub">${esc(o.subtitle)}</span>`
      : '';
    return `<span class="tma-frame-doc__text-block">
      <span class="tma-frame-doc__text-title">${esc(o.title)}</span>
      ${subtitle}
    </span>`;
  }

  function renderAvatar24() {
    return `<span class="tma-frame-doc__avatar">
      ${localImg('avatars/AvatarByewind.png', 'tma-frame-doc__avatar-img', 24, 24)}
    </span>`;
  }

  function renderCheckbox16(checked) {
    const key = checked ? 'Checkbox16Checked' : 'Checkbox16Unchecked';
    return `<button type="button" class="tma-frame-doc__checkbox" data-icon-text-checkbox aria-pressed="${checked ? 'true' : 'false'}">${fi(key, 'tma-frame-doc__checkbox-svg', 16, 16)}</button>`;
  }

  function renderAvatarNameExample(nodeId) {
    return `<div class="tma-frame-doc__chip tma-frame-doc__chip--grey tma-frame-doc__chip--avatar" data-node-id="${esc(nodeId)}">
      ${renderAvatar24()}
      ${renderTextBlock({ title: 'ByeWind' })}
    </div>`;
  }

  function renderSettingsRow(opts) {
    const o = opts || {};
    const subtitle = o.subtitle
      ? renderTextBlock({ title: o.title, subtitle: o.subtitle })
      : renderTextBlock({ title: o.title });
    return `<button type="button" class="tma-frame-doc__chip tma-frame-doc__chip--grey tma-frame-doc__chip--settings${o.tall ? ' tma-frame-doc__chip--settings-tall' : ''}" data-icon-text-settings data-node-id="${esc(o.nodeId)}">
      ${subtitle}
      <span class="tma-frame-doc__icon">${fi('ArrowLineRight16', 'tma-frame-doc__icon-svg', 16, 16)}</span>
    </button>`;
  }

  function renderCheckboxExample(label, checked, nodeId) {
    return `<div class="tma-frame-doc__chip tma-frame-doc__chip--checkbox" data-node-id="${esc(nodeId)}">
      ${renderCheckbox16(checked)}
      ${renderTextBlock({ title: label })}
    </div>`;
  }

  function renderNavItem(opts) {
    const o = opts || {};
    return `<button type="button" class="tma-frame-doc__chip tma-frame-doc__chip--grey tma-frame-doc__chip--nav" data-icon-text-nav aria-pressed="false" data-node-id="${esc(o.nodeId)}">
      <span class="tma-frame-doc__icon">${fi(o.icon, 'tma-frame-doc__icon-svg', 24, 24)}</span>
      ${renderTextBlock({ title: o.title })}
    </button>`;
  }

  function renderExamples() {
    return `<div class="tma-frame-doc__icon-text-examples" data-node-id="33302:498">
      <div class="tma-frame-doc__icon-text-block" data-node-id="33302:500">
        <p class="tma-frame-doc__hint" data-node-id="33302:501">Use it as a combination of avatar and name.</p>
        ${renderAvatarNameExample('33302:502')}
      </div>
      <div class="tma-frame-doc__icon-text-block" data-node-id="33302:503">
        <p class="tma-frame-doc__hint" data-node-id="33302:504">Use it as the settings component in the settings interface.</p>
        <div class="tma-frame-doc__icon-text-stack" data-node-id="33302:505">
          ${renderSettingsRow({ title: 'Email', nodeId: '33302:506' })}
          ${renderSettingsRow({
            title: 'Email',
            subtitle: 'Set a permanent password to login to your account.',
            tall: true,
            nodeId: '33302:507',
          })}
        </div>
      </div>
      <div class="tma-frame-doc__icon-text-block" data-node-id="33302:508">
        <p class="tma-frame-doc__hint" data-node-id="33302:509">Use it as a checkbox.</p>
        <div class="tma-frame-doc__icon-text-row" data-node-id="33302:510">
          ${renderCheckboxExample('Email', true, '33302:511')}
          ${renderCheckboxExample('Phone', false, '33302:512')}
        </div>
      </div>
      <div class="tma-frame-doc__icon-text-block" data-node-id="33302:513">
        <p class="tma-frame-doc__hint" data-node-id="33302:514">Use it as a navigation item.</p>
        <div class="tma-frame-doc__icon-text-stack" data-node-id="33302:515">
          ${renderNavItem({ icon: 'IdentificationBadgeDuotone24', title: 'User Profile', nodeId: '33302:516' })}
          ${renderNavItem({ icon: 'IdentificationCardDuotone24', title: 'Account', nodeId: '33302:517' })}
        </div>
      </div>
    </div>`;
  }

  function showToast(message) {
    const existing = document.querySelector('.tma-frame-inst__toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'tma-frame-inst__toast';
    toast.setAttribute('role', 'status');
    toast.textContent = message;
    document.body.appendChild(toast);

    requestAnimationFrame(() => {
      toast.classList.add('tma-frame-inst__toast--visible');
    });

    window.setTimeout(() => {
      toast.classList.remove('tma-frame-inst__toast--visible');
      window.setTimeout(() => toast.remove(), 200);
    }, 2200);
  }

  function toggleCheckbox(btn) {
    const next = btn.getAttribute('aria-pressed') !== 'true';
    btn.setAttribute('aria-pressed', next ? 'true' : 'false');
    btn.innerHTML = fi(
      next ? 'Checkbox16Checked' : 'Checkbox16Unchecked',
      'tma-frame-doc__checkbox-svg',
      16,
      16,
    );
  }

  function wireCheckboxes(root) {
    root.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-icon-text-checkbox]');
      if (!btn || !root.contains(btn)) return;
      event.preventDefault();
      event.stopPropagation();
      toggleCheckbox(btn);
    });
  }

  function wireSettingsRows(root) {
    root.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-icon-text-settings]');
      if (!btn || !root.contains(btn)) return;
      const title = btn.querySelector('.tma-frame-doc__text-title');
      showToast(title ? `Opening ${title.textContent.trim()} settings` : 'Opening settings');
    });
  }

  function wireNavItems(root) {
    root.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-icon-text-nav]');
      if (!btn || !root.contains(btn)) return;
      root.querySelectorAll('[data-icon-text-nav]').forEach((item) => {
        item.classList.remove('tma-frame-doc__chip--nav-active');
        item.setAttribute('aria-pressed', 'false');
      });
      btn.classList.add('tma-frame-doc__chip--nav-active');
      btn.setAttribute('aria-pressed', 'true');
      const title = btn.querySelector('.tma-frame-doc__text-title');
      showToast(title ? `Navigated to ${title.textContent.trim()}` : 'Navigated');
    });
  }

  function wireInteractivity(root) {
    if (!root) return;
    wireCheckboxes(root);
    wireSettingsRows(root);
    wireNavItems(root);
  }

  function mountDocumentation(opts) {
    const o = opts || {};
    if (o.examplesEl) {
      o.examplesEl.innerHTML = renderExamples();
      if (o.interactive !== false) wireInteractivity(o.examplesEl);
    }
    if (o.footerEl && window.TMAFrameDoc && window.TMAFrameDoc.renderDocumentationFooter) {
      o.footerEl.innerHTML = window.TMAFrameDoc.renderDocumentationFooter(o.socialSvg);
    }
  }

  window.TMAIconTextDoc = {
    renderExamples,
    mountDocumentation,
    wireInteractivity,
  };
})();
