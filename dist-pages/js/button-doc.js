/* TMA - Button documentation (Figma 33159:7245) */
(function () {
  'use strict';

  const NAV = [
    { key: 'home', label: 'Home', icon20: 'HouseDuotone20', icon24: 'HouseDuotone24', active: true },
    { key: 'history', label: 'History', icon20: 'ClockDuotone20', icon24: 'ClockDuotone24' },
    { key: 'user', label: 'User', icon20: 'UsersDuotone20', icon24: 'UsersDuotone24' },
    { key: 'folder', label: 'Folder', icon20: 'FolderDuotone20', icon24: 'FolderDuotone24' },
    { key: 'bookmark', label: 'Bookmark', icon20: 'BookmarkDuotone20', icon24: 'BookmarkDuotone24' },
  ];

  const SOCIAL = [
    { key: 'google', label: 'Sign in with Google', icon: 'Google16' },
    { key: 'apple', label: 'Sign in with Apple', icon: 'Apple16' },
    { key: 'microsoft', label: 'Sign in with Microsoft', icon: 'Microsoft16' },
    { key: 'facebook', label: 'Sign in with Facebook', icon: 'Facebook16' },
    { key: 'instagram', label: 'Sign in with Instagram', icon: 'Instagram16', width: 198 },
    { key: 'x', label: 'Sign in with X', icon: 'XLogo16' },
  ];

  const COMPLEX = [
    { eyebrow: 'SHOP', title: 'All products', icon: 'ShoppingCart40' },
    { eyebrow: 'PAYPAL', title: 'Check out', icon: 'PayPal40' },
    { eyebrow: 'GUMROAD', title: 'Buy now', icon: 'Gumroad40' },
  ];

  const FUNCTION = [
    { icon: 'MoonDuotone24', title: 'Do Not Disturb', subtitle: 'On', trailing: 'ThreeDots24' },
    { icon: 'BadgeDuotone24', title: 'Work', trailing: 'ThreeDots24', tall: true },
    { icon: 'BedDuotone24', title: 'Sleep', trailing: 'ThreeDots24', tall: true },
    { icon: 'PoliceCarDuotone24', title: 'Driving', trailing: 'ThreeDots24', tall: true },
  ];

  function di(key, cls, w, h) {
    return (window.TMAButtonDocIcons && window.TMAButtonDocIcons.svg(key, cls, w, h)) || '';
  }

  function esc(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderDocNavButton(item, opts) {
    const o = opts || {};
    const iconKey = o.iconSize === 24 ? item.icon24 : item.icon20;
    const px = o.iconSize === 24 ? 24 : 20;
    const active = item.active ? ' tma-button-doc__nav-btn--active' : '';
    const iconOnly = o.iconOnly ? ' tma-button-doc__nav-btn--icon-only' : '';
    const label = o.iconOnly
      ? ''
      : `<span class="tma-button-doc__nav-label">${esc(item.label)}</span>`;
    const icon = `<span class="tma-button-doc__nav-icon">${di(iconKey, 'tma-button-doc__nav-icon-svg', px, px)}</span>`;
    return `<button type="button" class="tma-button-doc__nav-btn${active}${iconOnly}" aria-pressed="${item.active ? 'true' : 'false'}">
      ${icon}${label}
    </button>`;
  }

  function renderDocGroup(opts) {
    const o = opts || {};
    const dir = o.direction === 'column' ? ' tma-button-doc__group--column' : '';
    const items = (o.items || NAV).map((item) => renderDocNavButton(item, {
      iconSize: o.iconSize,
      iconOnly: o.iconOnly,
    })).join('');
    return `<div class="tma-button-doc__group${dir}"${o.nodeId ? ` data-node-id="${esc(o.nodeId)}"` : ''}>${items}</div>`;
  }

  function renderSocialButton(item, iconOnly) {
    if (iconOnly) {
      return `<button type="button" class="tma-button-doc__social-btn tma-button-doc__social-btn--icon" aria-label="${esc(item.label)}">
        <span class="tma-button-doc__social-icon">${di(item.icon, 'tma-button-doc__social-icon-svg', 16, 16)}</span>
      </button>`;
    }
    const widthStyle = item.width ? ` style="width:${item.width}px"` : '';
    return `<button type="button" class="tma-button-doc__social-btn"${widthStyle} aria-label="${esc(item.label)}">
      <span class="tma-button-doc__social-icon">${di(item.icon, 'tma-button-doc__social-icon-svg', 16, 16)}</span>
      <span class="tma-button-doc__social-label">${esc(item.label)}</span>
    </button>`;
  }

  function renderSocialGrid() {
    const rows = SOCIAL.map((item) => `
      <div class="tma-button-doc__social-row">
        ${renderSocialButton(item, false)}
        ${renderSocialButton(item, true)}
      </div>`).join('');
    return `<div class="tma-button-doc__social-grid" data-node-id="33159:7271">${rows}</div>`;
  }

  function renderComplexButton(item, nodeId) {
    return `<button type="button" class="tma-button-doc__complex-btn"${nodeId ? ` data-node-id="${esc(nodeId)}"` : ''} aria-label="${esc(item.title)}">
      <span class="tma-button-doc__complex-copy">
        <span class="tma-button-doc__complex-eyebrow">${esc(item.eyebrow)}</span>
        <span class="tma-button-doc__complex-title">${esc(item.title)}</span>
      </span>
      <span class="tma-button-doc__complex-icon">${di(item.icon, 'tma-button-doc__complex-icon-svg', 40, 40)}</span>
    </button>`;
  }

  function renderComplexRow() {
    const ids = ['33159:7287', '33159:7288', '33159:7289'];
    return `<div class="tma-button-doc__complex-row" data-node-id="33159:7286">
      ${COMPLEX.map((item, i) => renderComplexButton(item, ids[i])).join('')}
    </div>`;
  }

  function renderFunctionButton(item, nodeId) {
    const tall = item.tall ? ' tma-button-doc__function-btn--tall' : '';
    const subtitle = item.subtitle
      ? `<span class="tma-button-doc__function-subtitle">${esc(item.subtitle)}</span>`
      : '';
    return `<button type="button" class="tma-button-doc__function-btn${tall}"${nodeId ? ` data-node-id="${esc(nodeId)}"` : ''} aria-label="${esc(item.title)}">
      <span class="tma-button-doc__function-icon">${di(item.icon, 'tma-button-doc__function-icon-svg', 24, 24)}</span>
      <span class="tma-button-doc__function-copy">
        <span class="tma-button-doc__function-title">${esc(item.title)}</span>
        ${subtitle}
      </span>
      <span class="tma-button-doc__function-trailing">${di(item.trailing, 'tma-button-doc__function-trailing-svg', 24, 24)}</span>
    </button>`;
  }

  function renderFunctionList() {
    const ids = ['33159:7293', '33159:7294', '33159:7295', '33159:7296'];
    return `<div class="tma-button-doc__function-list" data-node-id="33159:7292">
      ${FUNCTION.map((item, i) => renderFunctionButton(item, ids[i])).join('')}
    </div>`;
  }

  function renderSegButton(label, opts) {
    const o = opts || {};
    const active = o.active ? ' tma-button-doc__seg-btn--active' : '';
    const filled = o.filled ? ' tma-button-doc__seg-btn--filled' : '';
    const white = o.white ? ' tma-button-doc__seg-btn--white' : '';
    const pill = o.pill ? ' tma-button-doc__seg-btn--pill' : '';
    const iconOnly = o.iconOnly ? ' tma-button-doc__seg-btn--icon-only' : '';
    const icon = o.icon
      ? `<span class="tma-button-doc__seg-icon">${di(o.icon, 'tma-button-doc__seg-icon-svg', 24, 24)}</span>`
      : '';
    const text = label
      ? `<span class="tma-button-doc__seg-label">${esc(label)}</span>`
      : '';
    const pressed = o.active ? 'true' : 'false';
    return `<button type="button" class="tma-button-doc__seg-btn${active}${filled}${white}${pill}${iconOnly}" aria-pressed="${pressed}">${icon}${text}</button>`;
  }

  function renderSegGroup(inner, className, nodeId, segMode) {
    const modeAttr = segMode ? ` data-seg-mode="${esc(segMode)}"` : '';
    return `<div class="tma-button-doc__seg-group ${className}"${nodeId ? ` data-node-id="${esc(nodeId)}"` : ''}${modeAttr} role="group">${inner}</div>`;
  }

  function renderSegmentedExamples() {
    return `<div class="tma-button-doc__seg-stack" data-node-id="33159:7299">
      ${renderSegGroup([
        renderSegButton('Daily', { active: true, filled: true }),
        renderSegButton('Weekly'),
        renderSegButton('Monthly'),
      ].join(''), 'tma-button-doc__seg-group--large', '33159:7300', 'filled')}
      ${renderSegGroup([
        renderSegButton('Card', { white: true, icon: 'SquaresFour24' }),
        renderSegButton('list', { icon: 'ListBullets24' }),
      ].join(''), 'tma-button-doc__seg-group--large', '33159:7301', 'white')}
      ${renderSegGroup([
        renderSegButton('Card', { active: true, filled: true, pill: true, icon: 'SquaresFour24' }),
        renderSegButton('list', { icon: 'ListBullets24' }),
      ].join(''), 'tma-button-doc__seg-group--pill-track', '33159:7302', 'filled-pill')}
      ${renderSegGroup([
        renderSegButton('', { active: true, filled: true, pill: true, iconOnly: true, icon: 'SquaresFour24' }),
        renderSegButton('', { iconOnly: true, icon: 'ListBullets24' }),
      ].join(''), 'tma-button-doc__seg-group--icon-pill', '33159:7303', 'filled-pill-icon')}
      ${renderSegGroup([
        renderSegButton('', { white: true, iconOnly: true, icon: 'SunDimDuotone24' }),
        renderSegButton('', { iconOnly: true, icon: 'MoonDuotone24' }),
      ].join(''), 'tma-button-doc__seg-group--large', '33159:7304', 'white-icon')}
      ${renderSegGroup([
        renderSegButton('Monthly', { active: true, filled: true, pill: false }),
        renderSegButton('Yearly'),
      ].join(''), 'tma-button-doc__seg-group--compact', '33159:7305', 'filled-compact')}
      ${renderSegGroup([
        renderSegButton('Button', { white: true }),
        renderSegButton('Button'),
      ].join(''), 'tma-button-doc__seg-group--mini', '33159:7306', 'white-mini')}
    </div>`;
  }

  function renderExamples() {
    return `
    <div class="tma-button-doc__example-block" data-node-id="33159:7259">
      <p class="tma-button-doc__example-caption" data-node-id="33159:7260">Use button groups for navigation.</p>
      <p class="tma-button-doc__example-note" data-node-id="33159:7261">Since the button component itself has various types built in, it's easy to change the type of navigation.</p>
      ${renderDocGroup({ nodeId: '33159:7262', iconSize: 20 })}
      ${renderDocGroup({ nodeId: '33159:7263', iconSize: 24, iconOnly: true })}
      <p class="tma-button-doc__example-note" data-node-id="33159:7264">Change the direction of the Group component.</p>
      <div class="tma-button-doc__group-row" data-node-id="33159:7265">
        ${renderDocGroup({ nodeId: '33159:7266', direction: 'column', iconSize: 24 })}
        ${renderDocGroup({ nodeId: '33159:7267', direction: 'column', iconSize: 24, iconOnly: true })}
      </div>
      <p class="tma-button-doc__example-note" data-node-id="33159:7268">The combination of the two components will give greater play to the advantages of TMA component design.</p>
    </div>
    <div class="tma-button-doc__example-block" data-node-id="33159:7269">
      <p class="tma-button-doc__example-caption" data-node-id="33159:7270">Create social media buttons without adding component variations.</p>
      ${renderSocialGrid()}
    </div>
    <div class="tma-button-doc__example-block" data-node-id="33159:7284">
      <p class="tma-button-doc__example-caption" data-node-id="33159:7285">Complex buttons can also be created.</p>
      ${renderComplexRow()}
    </div>
    <div class="tma-button-doc__example-block" data-node-id="33159:7290">
      <p class="tma-button-doc__example-caption" data-node-id="33159:7291">Using buttons to perform specific functions will save a lot of effort in creating components.</p>
      ${renderFunctionList()}
    </div>
    <div class="tma-button-doc__example-block" data-node-id="33159:7297">
      <p class="tma-button-doc__example-caption" data-node-id="33159:7298">Segmented Controls can also be thought of as button groups.</p>
      ${renderSegmentedExamples()}
    </div>`;
  }

  function renderDocumentationFooter(socialSvg) {
    const ts = socialSvg || (() => '');
    return `<footer class="tma-button-doc__footer" data-node-id="33159:7307">
      <div class="tma-button-doc__footer-brand">
        <div class="tma-button-doc__logo" aria-hidden="true">
          ${ts('TMALogoMark', 'tma-button-doc__logo-icon', 28, 28)}
          <span class="tma-button-doc__wordmark">
            ${ts('TMALogoWordmark', 'tma-button-doc__wordmark-left', 53, 12)}
            ${ts('TMALogoSuffix', 'tma-button-doc__wordmark-right', 15, 12)}
          </span>
        </div>
        <p class="tma-button-doc__copyright">© 2026 TM ANTOINE Advisory. All rights reserved.</p>
      </div>
      <div class="tma-button-doc__socials">
        <a class="tma-button-doc__social-link" href="https://twitter.com/FarewelltoWind" target="_blank" rel="noopener noreferrer" aria-label="Twitter">${ts('TwitterSocial', '', 28, 28)}</a>
        <a class="tma-button-doc__social-link" href="https://www.instagram.com/farewelltowind" target="_blank" rel="noopener noreferrer" aria-label="Instagram">${ts('InstagramSocial', '', 28, 28)}</a>
        <a class="tma-button-doc__social-link" href="https://www.threads.net/@farewelltowind" target="_blank" rel="noopener noreferrer" aria-label="Threads">${ts('ThreadsLogo', '', 28, 28)}</a>
        <a class="tma-button-doc__social-link" href="https://dribbble.com/byewind" target="_blank" rel="noopener noreferrer" aria-label="Dribbble">${ts('DribbbleSocial', '', 28, 28)}</a>
        <a class="tma-button-doc__social-link" href="https://www.behance.net/ByeWind" target="_blank" rel="noopener noreferrer" aria-label="Behance">${ts('BehanceSocial', '', 28, 28)}</a>
        <a class="tma-button-doc__social-link" href="https://www.figma.com/@byewind" target="_blank" rel="noopener noreferrer" aria-label="Figma">${ts('FigmaSocial', '', 28, 28)}</a>
        <a class="tma-button-doc__social-link" href="#" target="_blank" rel="noopener noreferrer" aria-label="Website">${ts('TMALogoMark', '', 28, 28)}</a>
      </div>
    </footer>`;
  }

  function wireNavGroups(root) {
    root.querySelectorAll('.tma-button-doc__group').forEach((group) => {
      group.addEventListener('click', (event) => {
        const btn = event.target.closest('.tma-button-doc__nav-btn');
        if (!btn || !group.contains(btn)) return;
        group.querySelectorAll('.tma-button-doc__nav-btn').forEach((item) => {
          item.classList.remove('tma-button-doc__nav-btn--active');
          item.setAttribute('aria-pressed', 'false');
        });
        btn.classList.add('tma-button-doc__nav-btn--active');
        btn.setAttribute('aria-pressed', 'true');
      });
    });
  }

  function applySegSelection(group, btn) {
    const mode = group.dataset.segMode || 'filled';
    const buttons = group.querySelectorAll('.tma-button-doc__seg-btn');
    buttons.forEach((item) => {
      item.classList.remove(
        'tma-button-doc__seg-btn--active',
        'tma-button-doc__seg-btn--filled',
        'tma-button-doc__seg-btn--white',
        'tma-button-doc__seg-btn--pill'
      );
      item.setAttribute('aria-pressed', 'false');
    });

    if (mode === 'white' || mode === 'white-icon' || mode === 'white-mini') {
      btn.classList.add('tma-button-doc__seg-btn--white');
    } else {
      btn.classList.add('tma-button-doc__seg-btn--active', 'tma-button-doc__seg-btn--filled');
      if (mode === 'filled-pill' || mode === 'filled-pill-icon') {
        btn.classList.add('tma-button-doc__seg-btn--pill');
      }
    }
    btn.setAttribute('aria-pressed', 'true');
  }

  function wireSegGroups(root) {
    root.querySelectorAll('.tma-button-doc__seg-group').forEach((group) => {
      group.addEventListener('click', (event) => {
        const btn = event.target.closest('.tma-button-doc__seg-btn');
        if (!btn || !group.contains(btn)) return;
        applySegSelection(group, btn);
      });
    });
  }

  function wireDocumentationInteractivity(root) {
    if (!root) return;
    wireNavGroups(root);
    wireSegGroups(root);
  }

  function mountDocumentation(opts) {
    const o = opts || {};
    if (o.examplesEl) {
      o.examplesEl.innerHTML = renderExamples();
      wireDocumentationInteractivity(o.examplesEl);
    }
    if (o.footerEl && o.socialSvg) o.footerEl.innerHTML = renderDocumentationFooter(o.socialSvg);
  }

  window.TMAButtonDoc = {
    NAV,
    SOCIAL,
    renderDocNavButton,
    renderDocGroup,
    renderSocialGrid,
    renderComplexRow,
    renderFunctionList,
    renderSegmentedExamples,
    renderExamples,
    renderDocumentationFooter,
    wireDocumentationInteractivity,
    mountDocumentation,
  };
})();
