/* TMA - Button instances showcase (Figma 33159:7810) - absolute layout */
(function () {
  'use strict';

  const FRAME = { w: 3839, h: 958 };

  const NAV = [
    { key: 'home', label: 'Home', icon: 'HouseDuotone20', icon24: 'HouseDuotone24', active: true },
    { key: 'history', label: 'History', icon: 'ClockDuotone20', icon24: 'ClockDuotone24' },
    { key: 'user', label: 'User', icon: 'UsersDuotone20', icon24: 'UsersDuotone24' },
    { key: 'folder', label: 'Folder', icon: 'FolderDuotone20', icon24: 'FolderDuotone24' },
    { key: 'bookmark', label: 'Bookmark', icon: 'BookmarkDuotone20', icon24: 'BookmarkDuotone24' },
  ];

  const SOCIAL = [
    { key: 'google', label: 'Sign in with Google', icon: 'Google16' },
    { key: 'apple', label: 'Sign in with Apple', icon: 'Apple16' },
    { key: 'microsoft', label: 'Sign in with Microsoft', icon: 'Microsoft16' },
    { key: 'facebook', label: 'Sign in with Facebook', icon: 'Facebook16' },
    { key: 'instagram', label: 'Sign in with Instagram', icon: 'Instagram16' },
    { key: 'x', label: 'Sign in with X', icon: 'XLogo16' },
  ];

  const COMPLEX = {
    '33159:7838': { tone: 'indigo', eyebrow: 'PRO VERSION', title: 'Pre-order now', icon: 'ArrowRight40', iconTone: 'white' },
    '33159:7834': { tone: 'grey', eyebrow: 'SHOP', title: 'All products', icon: 'ShoppingCart40', iconTone: 'dark' },
    '33159:7837': { tone: 'grey', eyebrow: 'PAYPAL', title: 'Check out', iconPath: 'icons/brands/PayPal40.svg' },
    '33159:7835': { tone: 'grey', eyebrow: 'GUMROAD', title: 'Buy now', iconPath: 'icons/brands/Gumroad40.svg' },
    '33159:7836': { tone: 'grey', eyebrow: 'LEMON SQUEEZY', title: 'Buy now', iconPath: 'icons/brands/LemonSqueezy40.svg' },
  };

  const SUBSCRIBE = {
    '33159:7830': { tone: 'black', label: 'Subscribe' },
    '33159:7831': { tone: 'indigo', label: 'Subscribe' },
    '33159:7832': { tone: 'green', label: 'Subscribe' },
    '33159:7833': { tone: 'yellow', label: 'Subscribe' },
  };

  const LINKTREE = {
    '33159:7839': { avatarType: 'brand', label: 'Linktree button' },
    '33159:7840': { avatarType: 'avatar', avatar: 'AvatarByewind', label: 'Linktree button' },
    '33159:7841': { avatarType: 'icon', avatar: 'AppleBrand24', label: 'Linktree button' },
    '33159:7842': { avatarType: 'emoji', avatar: 'WinkingFaceTongue.svg', label: 'Linktree button' },
  };

  const FOCUS = {
    '33159:7896': { icon: 'MoonDuotone24', title: 'Do Not Disturb', subtitle: 'On' },
    '33159:7897': { icon: 'BadgeDuotone24', title: 'Work' },
    '33159:7898': { icon: 'BedDuotone24', title: 'Sleep' },
    '33159:7899': { icon: 'PoliceCarDuotone24', title: 'Driving' },
  };

  const GRID_LEFT = [
    { icon: 'SunDimDuotone24', tone: 'grey' },
    { icon: 'MoonDuotone24', tone: 'grey' },
    { icon: 'SunDimDuotone24', tone: 'filled' },
    { icon: 'MoonDuotone24', tone: 'filled' },
    { icon: 'ArrowUpRight24', tone: 'filled' },
    { icon: 'ThreeDots24', tone: 'filled' },
    { icon: 'Phone24', tone: 'indigo' },
    { icon: 'PhoneDisconnect24', tone: 'red' },
  ];

  const GRID_RIGHT = [
    { iconPath: 'icons/brands/Perplexity24.svg', tone: 'outlined' },
    { iconPath: 'icons/brands/Ollama24.svg', tone: 'outlined' },
    { iconPath: 'icons/brands/Claude24.svg', tone: 'outlined' },
    { iconPath: 'icons/brands/DeepSeek24.svg', tone: 'outlined' },
    { iconPath: 'icons/brands/ChatGPT24.svg', tone: 'outlined' },
    { iconPath: 'icons/brands/Slack24.svg', tone: 'outlined' },
    { iconPath: 'icons/brands/Youtube24.svg', tone: 'outlined' },
    { iconPath: 'icons/brands/XLogo24.svg', tone: 'outlined' },
  ];

  const GRID_LEFT_IDS = ['33159:7868', '33159:7870', '33159:7869', '33159:7871', '33159:7867', '33159:7880', '33159:7882', '33159:7881'];
  const GRID_RIGHT_IDS = ['33159:7876', '33159:7877', '33159:7879', '33159:7875', '33159:7872', '33159:7873', '33159:7874', '33159:7878'];

  function ii(key, cls, w, h) {
    const sources = [
      window.TMAButtonDocIcons,
      window.TMAButtonInstancesIcons,
      window.TMAButtonGroupDocIcons,
      window.TMALineIcons,
      window.TMAPopoverIcons,
      window.TMATableSearchIcons,
      window.TMACardIcons,
    ];
    for (let i = 0; i < sources.length; i += 1) {
      if (sources[i] && sources[i].svg) {
        const result = sources[i].svg(key, cls, w, h);
        if (result) return result;
      }
    }
    return '';
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
    return `<img class="${cls || ''}" src="${esc(src)}" alt="" style="${size}" />`;
  }

  function assets() {
    const table = window.TMAButtonInstancesIcons;
    return (table && table.FIGMA_ASSETS) || {};
  }

  function img(assetKey, cls, w, h) {
    const src = assets()[assetKey];
    if (!src) return '';
    const size = `width:${w}px;height:${h}px`;
    return `<img class="${cls || ''}" src="${esc(src)}" alt="" style="${size};object-fit:cover;border-radius:inherit" />`;
  }

  function esc(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function place(x, y, w, h, html, nodeId) {
    return `<div class="tma-btn-inst__node" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px" data-node-id="${esc(nodeId)}">${html}</div>`;
  }

  function renderNavGroup(opts) {
    const o = opts || {};
    const isColumn = o.direction === 'column';
    const isIconOnly = !!o.iconOnly;
    const iconPx = o.iconSize || (isIconOnly || isColumn ? 24 : 20);
    const dir = isColumn ? ' tma-btn-inst__nav-group--column' : '';
    const iconOnlyCls = isIconOnly ? ' tma-btn-inst__nav-group--icon-only' : '';
    const iconRowCls = isIconOnly && !isColumn ? ' tma-btn-inst__nav-group--icon-row' : '';
    const items = (o.items || NAV).map((item) => {
      const active = item.active ? ' tma-btn-inst__nav-btn--active' : '';
      const iconOnlyBtn = isIconOnly ? ' tma-btn-inst__nav-btn--icon-only' : '';
      const iconKey = iconPx >= 24 ? (item.icon24 || item.icon) : item.icon;
      const label = isIconOnly
        ? ''
        : `<span class="tma-btn-inst__nav-label">${esc(item.label)}</span>`;
      const icon = ii(iconKey, 'tma-btn-inst__nav-icon-svg', iconPx, iconPx);
      const aria = isIconOnly ? ` aria-label="${esc(item.label)}"` : '';
      return `<button type="button" class="tma-btn-inst__nav-btn${active}${iconOnlyBtn}" aria-pressed="${item.active ? 'true' : 'false'}"${aria}>
        <span class="tma-btn-inst__nav-icon">${icon}</span>${label}
      </button>`;
    }).join('');
    return `<div class="tma-btn-inst__nav-group${dir}${iconOnlyCls}${iconRowCls}" role="group">${items}</div>`;
  }

  function renderSocialFull(item) {
    return `<button type="button" class="tma-btn-inst__social-full" aria-label="${esc(item.label)}">
      <span class="tma-btn-inst__social-icon">${ii(item.icon, 'tma-btn-inst__social-icon-svg', 24, 24)}</span>
      <span class="tma-btn-inst__social-label">${esc(item.label)}</span>
    </button>`;
  }

  function renderSocialIcon(item) {
    return `<button type="button" class="tma-btn-inst__social-icon-only" aria-label="${esc(item.label)}">
      ${ii(item.icon, 'tma-btn-inst__social-icon-svg', 24, 24)}
    </button>`;
  }

  function renderBrandIcon(size, iconKey) {
    const px = size === 56 ? 24 : 16;
    const icon = ii(iconKey, 'tma-btn-inst__brand-icon-svg', px, px);
    return `<button type="button" class="tma-btn-inst__brand-icon tma-btn-inst__brand-icon--${size}" aria-label="Brand icon">${icon}</button>`;
  }

  function renderComplex(spec) {
    let arrow;
    if (spec.iconTone === 'white') {
      arrow = ii('ArrowRight40', 'tma-btn-inst__complex-arrow-svg', 40, 40);
    } else if (spec.iconPath) {
      arrow = localImg(spec.iconPath, 'tma-btn-inst__complex-arrow-img', 40, 40);
    } else if (spec.iconImg) {
      arrow = img(spec.iconImg, 'tma-btn-inst__complex-arrow-img', 40, 40);
    } else {
      arrow = ii(spec.icon, 'tma-btn-inst__complex-arrow-svg', 40, 40);
    }
    return `<button type="button" class="tma-btn-inst__complex tma-btn-inst__complex--${esc(spec.tone)}">
      <span class="tma-btn-inst__complex-copy">
        <span class="tma-btn-inst__complex-eyebrow">${esc(spec.eyebrow)}</span>
        <span class="tma-btn-inst__complex-title">${esc(spec.title)}</span>
      </span>
      <span class="tma-btn-inst__complex-arrow">${arrow}</span>
    </button>`;
  }

  function renderGetApp(badgeTone) {
    const badgeClass = badgeTone === 'red' ? ' tma-btn-inst__wide-badge--red' : '';
    return `<button type="button" class="tma-btn-inst__wide tma-btn-inst__wide--get-app">
      <span class="tma-btn-inst__wide-title">Get app</span>
      <span class="tma-btn-inst__wide-badge${badgeClass}">${ii('ArrowRight40', 'tma-btn-inst__wide-badge-svg', 40, 40)}</span>
    </button>`;
  }

  function renderGreyButtonArrow() {
    return `<button type="button" class="tma-btn-inst__wide tma-btn-inst__wide--grey-arrow">
      <span class="tma-btn-inst__wide-action-label">Button</span>
      <span class="tma-btn-inst__wide-arrow-box">${ii('ArrowRight24Black', 'tma-btn-inst__wide-arrow-svg', 24, 24)}</span>
    </button>`;
  }

  function renderPricingSplit(left, right) {
    return `<button type="button" class="tma-btn-inst__wide tma-btn-inst__wide--pricing">
      <span class="tma-btn-inst__pricing-left">${esc(left)}</span>
      <span class="tma-btn-inst__pricing-divider" aria-hidden="true"></span>
      <span class="tma-btn-inst__pricing-right">${esc(right)}</span>
    </button>`;
  }

  function renderTextWide(label, variant) {
    if (variant === 'compact') {
      return `<button type="button" class="tma-btn-inst__wide tma-btn-inst__wide--compact">
        <span class="tma-btn-inst__wide-action-label">${esc(label)}</span>
      </button>`;
    }

    const iconKey = variant === 'invest' ? 'Plus24' : 'ArrowUpRight24';
    return `<button type="button" class="tma-btn-inst__wide tma-btn-inst__wide--soft">
      <span class="tma-btn-inst__wide-action-label">${esc(label)}</span>
      <span class="tma-btn-inst__wide-action-icon">${ii(iconKey, 'tma-btn-inst__wide-action-icon-svg', 24, 24)}</span>
    </button>`;
  }

  function renderSubscribe(spec) {
    return `<button type="button" class="tma-btn-inst__subscribe tma-btn-inst__subscribe--${esc(spec.tone)}">
      <span class="tma-btn-inst__subscribe-icon">${ii('BellFill24', '', 24, 24)}</span>
      <span class="tma-btn-inst__subscribe-label">${esc(spec.label)}</span>
    </button>`;
  }

  function renderLinktree(spec) {
    const px = 40;
    let avatar;
    if (spec.avatarType === 'brand') {
      avatar = localImg(
        'images/brand/tma/tma-logo-mark.png',
        'tma-btn-inst__linktree-avatar-img tma-btn-inst__linktree-avatar-img--brand',
        px,
        px,
      );
    } else if (spec.avatarType === 'avatar') {
      avatar = localImg(
        `avatars/${spec.avatar}.png`,
        'tma-btn-inst__linktree-avatar-img tma-btn-inst__linktree-avatar-img--round',
        px,
        px,
      );
    } else if (spec.avatarType === 'emoji') {
      avatar = localImg(
        `emoji/${spec.avatar}`,
        'tma-btn-inst__linktree-avatar-img tma-btn-inst__linktree-avatar-img--emoji',
        px,
        px,
      );
    } else if (spec.avatarType === 'icon') {
      avatar = ii(spec.avatar, 'tma-btn-inst__linktree-avatar-svg tma-btn-inst__linktree-avatar-svg--apple', px, px);
    } else if (spec.avatarType === 'img') {
      avatar = img(spec.avatar, 'tma-btn-inst__linktree-avatar-img', px, px);
    } else {
      avatar = ii(spec.avatar, 'tma-btn-inst__linktree-avatar-svg', px, px);
    }
    return `<button type="button" class="tma-btn-inst__linktree">
      <span class="tma-btn-inst__linktree-avatar">${avatar}</span>
      <span class="tma-btn-inst__linktree-label">${esc(spec.label)}</span>
      <span class="tma-btn-inst__linktree-menu">${ii('ThreeDots24', 'tma-btn-inst__linktree-menu-svg', 24, 24)}</span>
    </button>`;
  }

  function renderFocus(spec) {
    const subtitle = spec.subtitle
      ? `<span class="tma-btn-inst__focus-sub">${esc(spec.subtitle)}</span>`
      : '';
    return `<button type="button" class="tma-btn-inst__focus${subtitle ? '' : ' tma-btn-inst__focus--title-only'}">
      <span class="tma-btn-inst__focus-icon">${ii(spec.icon, 'tma-btn-inst__focus-icon-svg', 24, 24)}</span>
      <span class="tma-btn-inst__focus-copy">
        <span class="tma-btn-inst__focus-title">${esc(spec.title)}</span>
        ${subtitle}
      </span>
      <span class="tma-btn-inst__focus-menu">${ii('ThreeDots24', 'tma-btn-inst__focus-menu-svg', 24, 24)}</span>
    </button>`;
  }

  function renderFull(label) {
    return `<button type="button" class="tma-btn-inst__full">${esc(label)}</button>`;
  }

  function renderFullContinue() {
    return `<button type="button" class="tma-btn-inst__full tma-btn-inst__full--icon">
      <span>Continue</span>
      <span class="tma-btn-inst__full-icon">${ii('ArrowLineRight20', '', 20, 20)}</span>
    </button>`;
  }

  function renderNavPair(prevLabel, nextLabel, nextIcon) {
    const nextIconHtml = nextIcon
      ? `<span class="tma-btn-inst__nav-pair-icon">${ii('ArrowLineRight20', '', 20, 20)}</span>`
      : '';
    return `<div class="tma-btn-inst__nav-pair" role="group">
      <button type="button" class="tma-btn-inst__nav-pair-btn tma-btn-inst__nav-pair-btn--grey">
        <span class="tma-btn-inst__nav-pair-icon">${ii('ArrowLineLeft20', '', 20, 20)}</span>
        <span>${esc(prevLabel)}</span>
      </button>
      <button type="button" class="tma-btn-inst__nav-pair-btn tma-btn-inst__nav-pair-btn--filled">
        <span>${esc(nextLabel)}</span>${nextIconHtml}
      </button>
    </div>`;
  }

  function renderXsPair(left, right) {
    return `<div class="tma-btn-inst__xs-pair" role="group">
      <button type="button" class="tma-btn-inst__xs-btn tma-btn-inst__xs-btn--grey">${esc(left)}</button>
      <button type="button" class="tma-btn-inst__xs-btn tma-btn-inst__xs-btn--filled">${esc(right)}</button>
    </div>`;
  }

  function renderSegGroup(labels, mode, activeIndex) {
    const idx = activeIndex == null ? 0 : activeIndex;
    const useFilled = mode === 'large' || mode === 'compact';
    const btns = labels.map((label, i) => {
      const active = i === idx ? ' tma-btn-inst__seg-btn--active' : '';
      const filled = i === idx && useFilled ? ' tma-btn-inst__seg-btn--filled' : '';
      return `<button type="button" class="tma-btn-inst__seg-btn${active}${filled}" aria-pressed="${i === idx ? 'true' : 'false'}">${esc(label)}</button>`;
    }).join('');
    return `<div class="tma-btn-inst__seg-group tma-btn-inst__seg-group--${esc(mode || 'default')}" role="group">${btns}</div>`;
  }

  function renderSegButton(label, opts) {
    const o = opts || {};
    const active = o.active ? ' tma-btn-inst__seg-btn--active' : '';
    const filled = o.filled ? ' tma-btn-inst__seg-btn--filled' : '';
    const white = o.white ? ' tma-btn-inst__seg-btn--white' : '';
    const pill = o.pill ? ' tma-btn-inst__seg-btn--pill' : '';
    const iconOnly = o.iconOnly ? ' tma-btn-inst__seg-btn--icon-only' : '';
    const icon = o.icon
      ? `<span class="tma-btn-inst__seg-icon">${ii(o.icon, 'tma-btn-inst__seg-icon-svg', 24, 24)}</span>`
      : '';
    const text = label
      ? `<span class="tma-btn-inst__seg-label">${esc(label)}</span>`
      : '';
    const pressed = o.active ? 'true' : 'false';
    return `<button type="button" class="tma-btn-inst__seg-btn${active}${filled}${white}${pill}${iconOnly}" aria-pressed="${pressed}">${icon}${text}</button>`;
  }

  function renderIconSegGroup(mode) {
    if (mode === 'card-list-white') {
      return `<div class="tma-btn-inst__seg-group tma-btn-inst__seg-group--large tma-btn-inst__seg-group--nowrap" role="group">
        ${renderSegButton('Card', { white: true, icon: 'SquaresFour24' })}
        ${renderSegButton('list', { icon: 'ListBullets24' })}
      </div>`;
    }
    if (mode === 'card-list-pill') {
      return `<div class="tma-btn-inst__seg-group tma-btn-inst__seg-group--pill-track tma-btn-inst__seg-group--nowrap" role="group">
        ${renderSegButton('Card', { active: true, filled: true, pill: true, icon: 'SquaresFour24' })}
        ${renderSegButton('list', { icon: 'ListBullets24' })}
      </div>`;
    }
    if (mode === 'icon-pill') {
      return `<div class="tma-btn-inst__seg-group tma-btn-inst__seg-group--icon-pill" role="group">
        ${renderSegButton('', { active: true, filled: true, pill: true, iconOnly: true, icon: 'SquaresFour24' })}
        ${renderSegButton('', { iconOnly: true, icon: 'ListBullets24' })}
      </div>`;
    }
    if (mode === 'sun-moon') {
      return `<div class="tma-btn-inst__seg-group tma-btn-inst__seg-group--large tma-btn-inst__seg-group--nowrap" role="group">
        ${renderSegButton('', { white: true, iconOnly: true, icon: 'SunDimDuotone24' })}
        ${renderSegButton('', { iconOnly: true, icon: 'MoonDuotone24' })}
      </div>`;
    }
    if (mode === 'brand-compact') {
      return `<div class="tma-btn-inst__seg-group tma-btn-inst__seg-group--brand-compact" role="group">
        <button type="button" class="tma-btn-inst__seg-btn tma-btn-inst__seg-btn--active tma-btn-inst__seg-btn--brand tma-btn-inst__seg-btn--brand-google" aria-pressed="true">${ii('Google16', 'tma-btn-inst__seg-icon-svg', 16, 16)}</button>
        <button type="button" class="tma-btn-inst__seg-btn tma-btn-inst__seg-btn--brand tma-btn-inst__seg-btn--brand-apple" aria-pressed="false">${ii('Apple16', 'tma-btn-inst__seg-icon-svg', 16, 16)}</button>
        <button type="button" class="tma-btn-inst__seg-btn tma-btn-inst__seg-btn--brand tma-btn-inst__seg-btn--brand-facebook" aria-pressed="false">${ii('Facebook16', 'tma-btn-inst__seg-icon-svg', 16, 16)}</button>
      </div>`;
    }
    return `<div class="tma-btn-inst__seg-group tma-btn-inst__seg-group--mini tma-btn-inst__seg-group--nowrap" role="group">
      ${renderSegButton('Button', { white: true })}
      ${renderSegButton('Button')}
    </div>`;
  }

  function renderPagination() {
    const pages = ['1', '2', '3', '4', '5'];
    const pageBtns = pages.map((page, i) => {
      const active = i === 0 ? ' tma-btn-inst__page-btn--active' : '';
      return `<button type="button" class="tma-btn-inst__page-btn${active}" data-page="${page}" aria-pressed="${i === 0 ? 'true' : 'false'}">${page}</button>`;
    }).join('');
    return `<div class="tma-btn-inst__pagination" role="group">
      ${pageBtns}
      <button type="button" class="tma-btn-inst__page-btn tma-btn-inst__page-btn--icon" data-action="prev" aria-label="Previous">${ii('ArrowLineLeft16', '', 16, 16)}</button>
      <button type="button" class="tma-btn-inst__page-btn tma-btn-inst__page-btn--icon" data-action="next" aria-label="Next">${ii('ArrowLineRight16', '', 16, 16)}</button>
    </div>`;
  }

  function renderChips() {
    return `<div class="tma-btn-inst__chips" role="group">
      <button type="button" class="tma-btn-inst__chip">
        <span class="tma-btn-inst__chip-avatar">${localImg('avatars/AvatarByewind.png', 'tma-btn-inst__chip-avatar-img', 20, 20)}</span>
        <span class="tma-btn-inst__chip-label">ByeWind</span>
        <span class="tma-btn-inst__chip-close">${ii('Close16', '', 16, 16)}</span>
      </button>
      <button type="button" class="tma-btn-inst__chip">
        <span class="tma-btn-inst__chip-avatar">${localImg('icons/brands/Slack24.svg', 'tma-btn-inst__chip-avatar-img', 20, 20)}</span>
        <span class="tma-btn-inst__chip-label">Slack</span>
        <span class="tma-btn-inst__chip-close">${ii('Close16', '', 16, 16)}</span>
      </button>
      <button type="button" class="tma-btn-inst__chip">
        <span class="tma-btn-inst__chip-label">byewind@twitter.com</span>
        <span class="tma-btn-inst__chip-close">${ii('Close16', '', 16, 16)}</span>
      </button>
    </div>`;
  }

  function renderToolbar() {
    return `<div class="tma-btn-inst__toolbar" role="group">
      <div class="tma-btn-inst__toolbar-start">
        <button type="button" class="tma-btn-inst__toolbar-icon" aria-label="Delete">${ii('Trash16', '', 16, 16)}</button>
        <button type="button" class="tma-btn-inst__toolbar-icon" aria-label="Image">${ii('Image16', '', 16, 16)}</button>
      </div>
      <div class="tma-btn-inst__toolbar-end">
        <span class="tma-btn-inst__toolbar-divider">|</span>
        <button type="button" class="tma-btn-inst__toolbar-btn tma-btn-inst__toolbar-btn--grey">Send late</button>
        <button type="button" class="tma-btn-inst__toolbar-btn tma-btn-inst__toolbar-btn--filled">Send</button>
      </div>
    </div>`;
  }

  function renderFrostedFooter() {
    return `<div class="tma-btn-inst__frosted" role="group">
      <button type="button" class="tma-btn-inst__xs-btn tma-btn-inst__xs-btn--grey">Cancel</button>
      <button type="button" class="tma-btn-inst__xs-btn tma-btn-inst__xs-btn--filled">Save Changes</button>
    </div>`;
  }

  function renderReplyForward() {
    return `<div class="tma-btn-inst__reply-forward" role="group">
      <button type="button" class="tma-btn-inst__reply-btn">
        ${ii('ArrowBendUpLeft16', '', 16, 16)}<span>Reply</span>
      </button>
      <button type="button" class="tma-btn-inst__reply-btn tma-btn-inst__reply-btn--forward">
        <span>Forward</span>${ii('ArrowBendUpRight16', '', 16, 16)}
      </button>
    </div>`;
  }

  function renderUndoExplain() {
    return `<div class="tma-btn-inst__undo-explain" role="group">
      <button type="button" class="tma-btn-inst__undo-btn">${ii('ArrowUUpLeft16', '', 16, 16)}<span>Undo</span></button>
      <button type="button" class="tma-btn-inst__explain-btn">${ii('Explain16', '', 16, 16)}<span>Explain</span></button>
    </div>`;
  }

  function renderLikeMessage() {
    return `<div class="tma-btn-inst__like-message" role="group">
      <span class="tma-btn-inst__like-text">Like</span>
      <button type="button" class="tma-btn-inst__message-btn">${ii('ChatTeardropDots16', '', 16, 16)}<span>Message</span></button>
    </div>`;
  }

  function renderGridIcon(spec, size) {
    const px = 24;
    let icon = '';
    if (spec.iconPath) {
      icon = localImg(spec.iconPath, 'tma-btn-inst__grid-icon-img', px, px);
    } else if (spec.iconImg) {
      icon = img(spec.iconImg, 'tma-btn-inst__grid-icon-img', px, px);
    } else {
      icon = ii(spec.icon, 'tma-btn-inst__grid-icon-svg', px, px);
    }
    return `<button type="button" class="tma-btn-inst__grid-icon tma-btn-inst__grid-icon--${size} tma-btn-inst__grid-icon--${esc(spec.tone)}" aria-label="Icon button">
      ${icon}
    </button>`;
  }

  function renderInstances() {
    const parts = [];

    parts.push(`<div class="tma-btn-inst" data-node-id="33159:7810" style="width:${FRAME.w}px;height:${FRAME.h}px">
      <svg class="tma-btn-inst__dash-border" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${FRAME.w} ${FRAME.h}" preserveAspectRatio="none">
        <rect x="1" y="1" width="${FRAME.w - 2}" height="${FRAME.h - 2}" rx="20" ry="20"/>
      </svg>
      <div class="tma-btn-inst__canvas">`);

    parts.push(place(100, 100, 648, 80, renderNavGroup({ iconSize: 20 }), '33159:7883'));
    parts.push(place(100, 198, 288, 80, renderNavGroup({ iconOnly: true, iconSize: 24 }), '33159:7884'));
    parts.push(place(100, 296, 180, 288, renderNavGroup({ direction: 'column', iconSize: 24 }), '33159:7886'));
    parts.push(place(308, 296, 80, 288, renderNavGroup({ direction: 'column', iconOnly: true, iconSize: 24 }), '33159:7885'));

    const socialFullIds = ['33159:7854', '33159:7856', '33159:7858', '33159:7860', '33159:7864', '33159:7862'];
    const socialIconIds = ['33159:7853', '33159:7855', '33159:7857', '33159:7859', '33159:7863', '33159:7861'];
    const socialFullYs = [100, 166, 232, 298, 364, 430];
    const socialIconYs = [496, 558, 620, 682, 744, 806];
    SOCIAL.forEach((item, i) => {
      parts.push(place(878, socialFullYs[i], 271, 56, renderSocialFull(item), socialFullIds[i]));
      parts.push(place(878, socialIconYs[i], 220, 48, renderSocialIcon(item), socialIconIds[i]));
    });

    const icon56Ids = ['33159:7844', '33159:7846', '33159:7848', '33159:7850', '33159:7866', '33159:7852'];
    const icon48Ids = ['33159:7843', '33159:7845', '33159:7847', '33159:7849', '33159:7865', '33159:7851'];
    const iconYs = [100, 166, 232, 298, 364, 430];
    const icon48Ys = [496, 558, 620, 682, 744, 806];
    SOCIAL.forEach((item, i) => {
      parts.push(place(1159, iconYs[i], 56, 56, renderBrandIcon(56, item.icon), icon56Ids[i]));
      parts.push(place(1108, icon48Ys[i], 48, 48, renderBrandIcon(48, item.icon), icon48Ids[i]));
    });

    Object.keys(COMPLEX).forEach((nodeId) => {
      const pos = {
        '33159:7838': [1235, 100, 320, 96],
        '33159:7834': [1235, 206, 320, 96],
        '33159:7837': [1235, 312, 320, 96],
        '33159:7835': [1235, 418, 320, 96],
        '33159:7836': [1235, 524, 320, 96],
      }[nodeId];
      parts.push(place(pos[0], pos[1], pos[2], pos[3], renderComplex(COMPLEX[nodeId]), nodeId));
    });

    parts.push(place(1575, 100, 280, 104, renderGetApp('blue'), '33159:7828'));
    parts.push(place(1575, 206, 280, 104, renderGetApp('red'), '33159:7829'));
    parts.push(place(1575, 312, 280, 72, renderTextWide('Send', 'send'), '33159:7826'));
    parts.push(place(1575, 398, 280, 72, renderTextWide('Invest', 'invest'), '33159:7827'));
    parts.push(place(1575, 484, 280, 64, renderGreyButtonArrow(), '33159:7825'));
    parts.push(place(1575, 558, 280, 52, renderPricingSplit('Unlock content', '$99/mo'), '33159:7894'));
    parts.push(place(1575, 624, 280, 52, renderPricingSplit('Unlock project', '$10'), '33159:7895'));

    Object.keys(SUBSCRIBE).forEach((nodeId) => {
      const pos = {
        '33159:7830': [1875, 100, 148, 48],
        '33159:7831': [1875, 166, 148, 48],
        '33159:7832': [1875, 232, 148, 48],
        '33159:7833': [1875, 298, 148, 48],
      }[nodeId];
      parts.push(place(pos[0], pos[1], pos[2], pos[3], renderSubscribe(SUBSCRIBE[nodeId]), nodeId));
    });

    Object.keys(LINKTREE).forEach((nodeId) => {
      const pos = {
        '33159:7839': [2061, 100, 320, 72],
        '33159:7840': [2061, 182, 320, 72],
        '33159:7841': [2061, 264, 320, 72],
        '33159:7842': [2061, 346, 320, 72],
      }[nodeId];
      parts.push(place(pos[0], pos[1], pos[2], pos[3], renderLinktree(LINKTREE[nodeId]), nodeId));
    });

    Object.keys(FOCUS).forEach((nodeId) => {
      const pos = {
        '33159:7896': [2061, 438, 320, 80],
        '33159:7897': [2061, 528, 320, 80],
        '33159:7898': [2061, 618, 320, 80],
        '33159:7899': [2061, 708, 320, 80],
      }[nodeId];
      parts.push(place(pos[0], pos[1], pos[2], pos[3], renderFocus(FOCUS[nodeId]), nodeId));
    });

    const gridYs = [100, 166, 232, 298, 364, 430, 496, 562];
    GRID_LEFT.forEach((spec, i) => {
      parts.push(place(2401, gridYs[i], 56, 56, renderGridIcon(spec, 56), GRID_LEFT_IDS[i]));
    });
    GRID_RIGHT.forEach((spec, i) => {
      parts.push(place(2467, gridYs[i], 56, 56, renderGridIcon(spec, 56), GRID_RIGHT_IDS[i]));
    });

    parts.push(place(2543, 100, 384, 36, renderFull('Sign In'), '33159:7819'));
    parts.push(place(2543, 150, 384, 36, renderFull('Sign Up'), '33159:7820'));
    parts.push(place(2543, 200, 384, 36, renderFull('Submit'), '33159:7821'));
    parts.push(place(2543, 250, 384, 36, renderFullContinue(), '33159:7822'));
    parts.push(place(2543, 300, 384, 36, renderNavPair('Previous', 'Continue', true), '33159:7823'));
    parts.push(place(2543, 350, 384, 36, renderNavPair('Previous', 'Submit', false), '33159:7824'));

    parts.push(place(2947, 100, 299, 64, renderSegGroup(['Daily', 'Weekly', 'Monthly'], 'large'), '33159:7891'));
    parts.push(place(2947, 182, 223, 64, renderIconSegGroup('card-list-white'), '33159:7889'));
    parts.push(place(2947, 264, 207, 48, renderIconSegGroup('card-list-pill'), '33159:7892'));
    parts.push(place(2947, 330, 96, 48, renderIconSegGroup('icon-pill'), '33159:7893'));
    parts.push(place(2947, 396, 116, 64, renderIconSegGroup('sun-moon'), '33159:7890'));
    parts.push(place(2947, 478, 260, 32, renderSegGroup(['Monthly', 'Yearly'], 'compact'), '33159:7888'));
    parts.push(place(2947, 524, 136, 32, renderIconSegGroup('mini-white'), '33159:7887'));

    parts.push(place(3309, 100, 430, 28, renderPagination(), '33159:7900'));
    parts.push(place(3309, 138, 420, 28, renderChips(), '33159:7815'));
    parts.push(place(3309, 176, 169, 24, renderXsPair('Learn more', 'Try Now'), '33159:7817'));
    parts.push(place(3309, 210, 138, 24, renderXsPair('Sign up', 'Sign in'), '33159:7811'));
    parts.push(place(3309, 248, 168, 24, renderUndoExplain(), '33159:7812'));
    parts.push(place(3309, 286, 131, 24, renderLikeMessage(), '33159:7818'));
    parts.push(place(3309, 324, 265, 64, renderToolbar(), '33159:7814'));
    parts.push(place(3309, 402, 223, 64, renderReplyForward(), '33159:7813'));
    parts.push(place(3309, 480, 234, 64, renderFrostedFooter(), '33159:7816'));

    parts.push('</div></div>');
    return parts.join('');
  }

  function wireNavGroups(root) {
    root.querySelectorAll('.tma-btn-inst__nav-group').forEach((group) => {
      group.addEventListener('click', (event) => {
        const btn = event.target.closest('.tma-btn-inst__nav-btn');
        if (!btn || !group.contains(btn)) return;
        group.querySelectorAll('.tma-btn-inst__nav-btn').forEach((item) => {
          item.classList.remove('tma-btn-inst__nav-btn--active');
          item.setAttribute('aria-pressed', 'false');
        });
        btn.classList.add('tma-btn-inst__nav-btn--active');
        btn.setAttribute('aria-pressed', 'true');
      });
    });
  }

  function wirePagination(root) {
    root.querySelectorAll('.tma-btn-inst__pagination').forEach((group) => {
      const pageButtons = () => Array.from(group.querySelectorAll('[data-page]'));
      const setActive = (btn) => {
        pageButtons().forEach((item) => {
          item.classList.remove('tma-btn-inst__page-btn--active');
          item.setAttribute('aria-pressed', 'false');
        });
        btn.classList.add('tma-btn-inst__page-btn--active');
        btn.setAttribute('aria-pressed', 'true');
      };
      group.addEventListener('click', (event) => {
        const target = event.target.closest('button');
        if (!target || !group.contains(target)) return;
        if (target.dataset.page) {
          setActive(target);
          return;
        }
        const buttons = pageButtons();
        const idx = buttons.findIndex((b) => b.classList.contains('tma-btn-inst__page-btn--active'));
        if (target.dataset.action === 'prev' && idx > 0) setActive(buttons[idx - 1]);
        if (target.dataset.action === 'next' && idx < buttons.length - 1) setActive(buttons[idx + 1]);
      });
    });
  }

  function wireSegGroups(root) {
    root.querySelectorAll('.tma-btn-inst__seg-group').forEach((group) => {
      group.addEventListener('click', (event) => {
        const btn = event.target.closest('.tma-btn-inst__seg-btn');
        if (!btn || !group.contains(btn)) return;
        group.querySelectorAll('.tma-btn-inst__seg-btn').forEach((item) => {
          item.classList.remove('tma-btn-inst__seg-btn--active');
          item.setAttribute('aria-pressed', 'false');
        });
        btn.classList.add('tma-btn-inst__seg-btn--active');
        btn.setAttribute('aria-pressed', 'true');
      });
    });
  }

  function wireInteractivity(root) {
    if (!root) return;
    wireNavGroups(root);
    wirePagination(root);
    wireSegGroups(root);
  }

  function mountInstances(el, opts) {
    if (!el) return;
    el.innerHTML = renderInstances();
    if (!opts || opts.interactive !== false) wireInteractivity(el);
  }

  window.TMAButtonInstances = {
    FRAME,
    NAV,
    SOCIAL,
    renderInstances,
    mountInstances,
    wireInteractivity,
  };
})();
