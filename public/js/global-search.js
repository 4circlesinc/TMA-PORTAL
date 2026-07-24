(function () {
  'use strict';

  let cachedAssetBase = null;

  function pageRelativeImagesBase() {
    if (typeof location === 'undefined') return '../images/';

    const segments = (location.pathname || '').split('/').filter(Boolean);
    if (segments.length && /\.[a-z0-9]+$/i.test(segments[segments.length - 1])) {
      segments.pop();
    }

    if (segments.length === 0) return 'images/';
    return `${'../'.repeat(segments.length)}images/`;
  }

  function assetBase() {
    if (window.TMAGlobalSearchAssetBase) {
      const base = window.TMAGlobalSearchAssetBase;
      return base.endsWith('/') ? base : `${base}/`;
    }

    if (!cachedAssetBase) {
      cachedAssetBase = pageRelativeImagesBase();
    }

    return cachedAssetBase;
  }

  function assetPath(relativePath) {
    return `${assetBase()}${relativePath.replace(/^\//, '')}`;
  }

  const ICON_INLINE = {
    Search: '<svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M28.6999 28.7125C28.5133 28.8963 28.2619 28.9996 27.9999 29C27.7344 28.9989 27.4794 28.896 27.2874 28.7125L21.8874 23.3C19.6132 25.2103 16.6892 26.1688 13.7255 25.9756C10.7617 25.7825 7.98686 24.4526 5.97976 22.2633C3.97266 20.074 2.88824 17.1944 2.95267 14.225C3.01709 11.2556 4.22539 8.42577 6.32555 6.32561C8.42571 4.22545 11.2556 3.01715 14.225 2.95273C17.1943 2.8883 20.074 3.97272 22.2632 5.97982C24.4525 7.98692 25.7824 10.7617 25.9756 13.7255C26.1687 16.6893 25.2102 19.6132 23.2999 21.8875L28.6999 27.2875C28.7944 27.3806 28.8695 27.4915 28.9207 27.6138C28.9719 27.7361 28.9983 27.8674 28.9983 28C28.9983 28.1326 28.9719 28.2639 28.9207 28.3862C28.8695 28.5085 28.7944 28.6195 28.6999 28.7125ZM14.4999 24C16.3789 24 18.2156 23.4428 19.7779 22.399C21.3401 21.3551 22.5578 19.8714 23.2768 18.1355C23.9958 16.3996 24.184 14.4895 23.8174 12.6467C23.4508 10.8038 22.5461 9.11109 21.2175 7.7825C19.8889 6.4539 18.1961 5.54911 16.3533 5.18255C14.5105 4.81599 12.6004 5.00412 10.8645 5.72316C9.12856 6.44219 7.64486 7.65983 6.60099 9.22209C5.55711 10.7844 4.99995 12.6211 4.99995 14.5C5.00326 17.0186 6.00521 19.433 7.78609 21.2139C9.56697 22.9948 11.9814 23.9967 14.4999 24Z" fill="black"/></svg>',
    Loading: '<svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path opacity="0.2" d="M22 16C22 14.8954 22.8954 14 24 14H30C31.1046 14 32 14.8954 32 16C32 17.1046 31.1046 18 30 18H24C22.8954 18 22 17.1046 22 16Z" fill="black"/><path opacity="0.6" d="M0 16C0 14.8954 0.895431 14 2 14H8C9.10457 14 10 14.8954 10 16C10 17.1046 9.10457 18 8 18H2C0.89543 18 0 17.1046 0 16Z" fill="black"/><path opacity="0.4" d="M16 22C17.1046 22 18 22.8954 18 24L18 30C18 31.1046 17.1046 32 16 32C14.8954 32 14 31.1046 14 30L14 24C14 22.8954 14.8954 22 16 22Z" fill="black"/><path opacity="0.8" d="M16 0C17.1046 0 18 0.895431 18 2L18 8C18 9.10457 17.1046 10 16 10C14.8954 10 14 9.10457 14 8L14 2C14 0.89543 14.8954 0 16 0Z" fill="black"/><path opacity="0.3" d="M20.2426 20.2426C21.0237 19.4616 22.29 19.4616 23.0711 20.2426L27.3137 24.4853C28.0948 25.2663 28.0948 26.5327 27.3137 27.3137C26.5327 28.0948 25.2663 28.0948 24.4853 27.3137L20.2426 23.0711C19.4616 22.29 19.4616 21.0237 20.2426 20.2426Z" fill="black"/><path opacity="0.7" d="M4.68625 4.68629C5.4673 3.90524 6.73363 3.90524 7.51468 4.68629L11.7573 8.92893C12.5384 9.70998 12.5384 10.9763 11.7573 11.7574C10.9763 12.5384 9.70994 12.5384 8.92889 11.7574L4.68625 7.51472C3.9052 6.73367 3.9052 5.46734 4.68625 4.68629Z" fill="black"/><path opacity="0.5" d="M11.7574 20.2426C12.5385 21.0237 12.5385 22.29 11.7574 23.0711L7.51478 27.3137C6.73373 28.0948 5.4674 28.0948 4.68635 27.3137C3.9053 26.5327 3.9053 25.2663 4.68635 24.4853L8.92899 20.2426C9.71004 19.4616 10.9764 19.4616 11.7574 20.2426Z" fill="black"/><path opacity="0.1" d="M27.3137 4.6863C28.0947 5.46734 28.0947 6.73367 27.3137 7.51472L23.0711 11.7574C22.29 12.5384 21.0237 12.5384 20.2426 11.7574C19.4616 10.9763 19.4616 9.70999 20.2426 8.92894L24.4853 4.6863C25.2663 3.90525 26.5326 3.90525 27.3137 4.6863Z" fill="black"/></svg>',
    XCircle: '<svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M20.7075 12.7075L17.4138 16L20.7075 19.2925C20.8004 19.3854 20.8741 19.4957 20.9244 19.6171C20.9747 19.7385 21.0006 19.8686 21.0006 20C21.0006 20.1314 20.9747 20.2615 20.9244 20.3829C20.8741 20.5043 20.8004 20.6146 20.7075 20.7075C20.6146 20.8004 20.5043 20.8741 20.3829 20.9244C20.2615 20.9747 20.1314 21.0006 20 21.0006C19.8686 21.0006 19.7385 20.9747 19.6171 20.9244C19.4957 20.8741 19.3854 20.8004 19.2925 20.7075L16 17.4137L12.7075 20.7075C12.6146 20.8004 12.5043 20.8741 12.3829 20.9244C12.2615 20.9747 12.1314 21.0006 12 21.0006C11.8686 21.0006 11.7385 20.9747 11.6171 20.9244C11.4957 20.8741 11.3854 20.8004 11.2925 20.7075C11.1996 20.6146 11.1259 20.5043 11.0756 20.3829C11.0253 20.2615 10.9994 20.1314 10.9994 20C10.9994 19.8686 11.0253 19.7385 11.0756 19.6171C11.1259 19.4957 11.1996 19.3854 11.2925 19.2925L14.5863 16L11.2925 12.7075C11.1049 12.5199 10.9994 12.2654 10.9994 12C10.9994 11.7346 11.1049 11.4801 11.2925 11.2925C11.4801 11.1049 11.7346 10.9994 12 10.9994C12.2654 10.9994 12.5199 11.1049 12.7075 11.2925L16 14.5863L19.2925 11.2925C19.3854 11.1996 19.4957 11.1259 19.6171 11.0756C19.7385 11.0253 19.8686 10.9994 20 10.9994C20.1314 10.9994 20.2615 11.0253 20.3829 11.0756C20.5043 11.1259 20.6146 11.1996 20.7075 11.2925C20.8004 11.3854 20.8741 11.4957 20.9244 11.6171C20.9747 11.7385 21.0006 11.8686 21.0006 12C21.0006 12.1314 20.9747 12.2615 20.9244 12.3829C20.8741 12.5043 20.8004 12.6146 20.7075 12.7075ZM29 16C29 18.5712 28.2376 21.0846 26.8091 23.2224C25.3807 25.3603 23.3503 27.0265 20.9749 28.0104C18.5995 28.9944 15.9856 29.2518 13.4638 28.7502C10.9421 28.2486 8.6257 27.0105 6.80762 25.1924C4.98953 23.3743 3.75141 21.0579 3.2498 18.5362C2.74819 16.0144 3.00563 13.4006 3.98957 11.0251C4.97351 8.64968 6.63975 6.61935 8.77759 5.1909C10.9154 3.76244 13.4288 3 16 3C19.4467 3.00364 22.7512 4.37445 25.1884 6.81163C27.6256 9.24882 28.9964 12.5533 29 16ZM27 16C27 13.8244 26.3549 11.6977 25.1462 9.88873C23.9375 8.07979 22.2195 6.66989 20.2095 5.83733C18.1995 5.00476 15.9878 4.78692 13.854 5.21136C11.7202 5.6358 9.76021 6.68345 8.22183 8.22183C6.68345 9.7602 5.63581 11.7202 5.21137 13.854C4.78693 15.9878 5.00477 18.1995 5.83733 20.2095C6.66989 22.2195 8.07979 23.9375 9.88873 25.1462C11.6977 26.3549 13.8244 27 16 27C18.9164 26.9967 21.7123 25.8367 23.7745 23.7745C25.8367 21.7123 26.9967 18.9164 27 16Z" fill="black"/></svg>',
  };

  function iconMarkup(key, className, width, height) {
    const inline = ICON_INLINE[key];
    if (inline) {
      const extraClass = className ? ` class="${className}"` : '';
      return inline.replace('<svg', `<svg${extraClass} width="${width}" height="${height}"`);
    }
    return `<img src="${iconUrl(key)}" alt="" class="${className}" width="${width}" height="${height}" />`;
  }

  const ICON_FILES = {
    Search: 'icons/tma/Search.svg',
    Search16: 'icons/tma/Search-16.svg',
    XCircle: 'icons/tma/Xcircle.svg',
    Xcircle: 'icons/tma/Xcircle.svg',
    X: 'icons/phosphor/X.svg',
    Loading: 'icons/tma/Loading.svg',
    Loading16: 'icons/tma/Loading-16.svg',
    User: 'icons/phosphor/User.svg',
    FileText: 'icons/phosphor/FileText.svg',
    BugBeetle: 'icons/phosphor/BugBeetle.svg',
    Broadcast: 'icons/phosphor/Broadcast.svg',
    ArrowRise: 'icons/tma/ArrowRise.svg',
    ArrowFall: 'icons/tma/ArrowFall.svg',
    Goto: 'icons/tma/Goto.svg',
    DonutChart: 'charts/DonutChart-01.svg',
    ChartMotion: 'charts/ChartMotion-01.svg',
    DefaultIcon: 'icons/tma/DefaultIcon.svg',
    ChartPie: 'icons/phosphor/ChartPie.svg',
    Storefront: 'icons/phosphor/Storefront.svg',
    Folder: 'icons/phosphor/Folder.svg',
    SidebarSimple: 'icons/phosphor/SidebarSimple.svg',
    SquaresFour: 'icons/phosphor/SquaresFour.svg',
    Sun: 'icons/phosphor/Sun.svg',
    Bell: 'icons/phosphor/Bell.svg',
    ClockCounterClockwise: 'icons/phosphor/ClockCounterClockwise.svg',
    Star: 'icons/phosphor/Star.svg',
    Rightbar: 'icons/tma/Rightbar.svg',
    Sidebar: 'icons/tma/Sidebar.svg',
  };

  function resolveAsset(value) {
    if (!value) return '';
    if (/^(https?:|data:|blob:)/.test(value)) return value;
    if (value.startsWith('../') || value.startsWith('./')) return value;
    if (value.startsWith('/')) {
      return assetPath(value.replace(/^\/?images\//, ''));
    }
    return assetPath(value);
  }

  function icons() {
    const custom = window.TMAGlobalSearchIcons || {};
    const merged = {};

    Object.entries(ICON_FILES).forEach(([key, rel]) => {
      merged[key] = resolveAsset(custom[key] || rel);
    });

    Object.entries(custom).forEach(([key, val]) => {
      if (!merged[key]) merged[key] = resolveAsset(val);
    });

    merged.XCircle = merged.XCircle || merged.Xcircle;
    merged.Search16 = merged.Search16 || merged['Search-16'];
    merged.Loading = merged.Loading || merged.Loading32 || resolveAsset('icons/tma/Loading.svg');
    merged.Loading16 = merged.Loading16 || merged['Loading-16'] || resolveAsset('icons/tma/Loading-16.svg');
    return merged;
  }

  function iconUrl(key) {
    const map = icons();
    return map[key] || map.XCircle || resolveAsset(ICON_FILES[key] || '') || '';
  }

  /* Live portal header/sidebar search starts empty; real entries come from options.index / TMAGlobalSearchIndex. */
  const DEFAULT_INDEX = [];

  /* ByeWind sample corpus — design-system interactive scenes only (never dashboard search). */
  const DESIGN_DEMO_INDEX = [
    { type: 'query', label: 'Landing page design', keywords: ['landing', 'page', 'design'] },
    { type: 'user', label: 'ByeWind', avatar: 'AvatarByewind', keywords: ['byewind', 'bye', 'wind'], href: '#user-byewind' },
    { type: 'page', label: 'Overview', keywords: ['overview'], href: '#overview' },
    { type: 'page', title: 'Overview', subtitle: "I'm ByeWind, a Product UX/UI Designer, based in China.", keywords: ['byewind', 'wind', 'overview'], href: '#overview' },
    { type: 'page', label: "ByeWind's profile", keywords: ['byewind', 'wind', 'profile'], href: '#profile-byewind' },
    { type: 'page', label: 'Farewell to Wind', keywords: ['farewell', 'wind'], href: '#farewell-wind' },
    { type: 'page', label: 'https://twitter.com/FarewelltoWind', keywords: ['twitter', 'farewell', 'wind'], href: 'https://twitter.com/FarewelltoWind' },
    { type: 'user', label: 'Emma Smith', avatar: 'Avatar3d04', keywords: ['emma', 'smith'], href: '#user-emma' },
    { type: 'user', label: 'Melody Macy', avatar: 'AvatarFemale05', keywords: ['melody', 'macy'], href: '#user-melody' },
  ];

  function avatarSrc(name) {
    return `${assetBase()}avatars/${name}.png`;
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function highlightText(text, query) {
    const safe = escapeHtml(text);
    if (!query) return safe;
    const re = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'ig');
    return safe.replace(re, '<span class="tma-search-popup__highlight">$1</span>');
  }

  function splitHighlight(text, query) {
    if (!query) return escapeHtml(text);
    const lower = text.toLowerCase();
    const q = query.toLowerCase();
    const idx = lower.indexOf(q);
    if (idx === -1) return escapeHtml(text);
    const before = text.slice(0, idx);
    const match = text.slice(idx, idx + query.length);
    const after = text.slice(idx + query.length);
    return `${escapeHtml(before)}<span class="tma-search-popup__highlight">${escapeHtml(match)}</span>${escapeHtml(after)}`;
  }

  function overviewNavItem(label, iconKey, active = false) {
    const cls = active ? ' tma-overview__nav-item--active' : '';
    return `<div class="tma-overview__nav-item${cls}"><img src="${iconUrl(iconKey)}" alt="" class="tma-overview__nav-icon" width="16" height="16" />${label}</div>`;
  }

  function overviewHeaderIcon(iconKey) {
    return `<button type="button" class="tma-overview__header-icon" tabindex="-1" aria-hidden="true"><img src="${iconUrl(iconKey)}" alt="" width="16" height="16" /></button>`;
  }

  function overviewActivity(title, meta, avatar) {
    return `<div class="tma-overview__activity">
      <img src="${avatarSrc(avatar)}" alt="" class="tma-overview__avatar" width="24" height="24" />
      <div>
        <div class="tma-overview__notice-title">${escapeHtml(title)}</div>
        <div class="tma-overview__notice-meta">${escapeHtml(meta)}</div>
      </div>
    </div>`;
  }

  function overviewNotice(title, meta, iconKey, tone) {
    return `<div class="tma-overview__notice">
      <div class="tma-overview__notice-icon tma-overview__notice-icon--${tone}"><img src="${iconUrl(iconKey)}" alt="" width="16" height="16" /></div>
      <div>
        <div class="tma-overview__notice-title">${escapeHtml(title)}</div>
        <div class="tma-overview__notice-meta">${escapeHtml(meta)}</div>
      </div>
    </div>`;
  }

  function overviewContact(name, avatar) {
    return `<div class="tma-overview__contact"><img src="${avatarSrc(avatar)}" alt="" class="tma-overview__avatar" width="24" height="24" /><span class="tma-overview__contact-name">${escapeHtml(name)}</span></div>`;
  }

  function renderOverviewRightbar(variant) {
    if (variant === 'layout') {
      return `<div class="tma-overview__panel-title">Notifications</div>
        ${overviewNotice('You fixed a bug.', 'Just now', 'BugBeetle', 'purple')}
        ${overviewNotice('New user registeRed.', '59 minutes ago', 'Broadcast', 'blue')}
        ${overviewNotice('You fixed a bug.', '12 hours ago', 'BugBeetle', 'purple')}
        ${overviewNotice('Andi Lane subscribed to you.', 'Today, 11:59 AM', 'User', 'blue')}
        <div class="tma-overview__panel-title">Activities</div>
        ${overviewActivity('Changed the style.', 'Just now', 'AvatarAbstract03')}
        ${overviewActivity('Released a new version.', '59 minutes ago', 'AvatarFemale03')}
        ${overviewActivity('Submitted a bug.', '12 hours ago', 'AvatarMale02')}
        ${overviewActivity('Modified A data in Page X.', 'Today, 11:59 AM', 'Avatar3d03')}
        ${overviewActivity('Deleted a page in Project X.', 'Feb 2, 2026', 'AvatarAbstract04')}
        <div class="tma-overview__panel-title">Clients</div>
        ${overviewContact('Natali Craig', 'AvatarFemale06')}
        ${overviewContact('Drew Cano', 'AvatarMale01')}
        ${overviewContact('Andi Lane', 'AvatarFemale01')}
        ${overviewContact('Koray Okumus', 'AvatarMale04')}
        ${overviewContact('Kate Morrison', 'AvatarFemale04')}
        ${overviewContact('Melody Macy', 'AvatarFemale05')}`;
    }

    return `<div class="tma-overview__panel-title">Notifications</div>
      ${overviewNotice('You fixed a bug.', 'Just now', 'BugBeetle', 'purple')}
      ${overviewNotice('New user registeRed.', '59 minutes ago', 'Broadcast', 'blue')}
      <div class="tma-overview__panel-title">Clients</div>
      ${overviewContact('Natali Craig', 'AvatarFemale06')}
      ${overviewContact('Drew Cano', 'AvatarMale01')}
      ${overviewContact('Andi Lane', 'AvatarFemale01')}`;
  }

  function renderOverview(options = {}) {
    const chartDonut = iconUrl('DonutChart');
    const chartMotion = iconUrl('ChartMotion');
    const interactive = !!options.interactive;
    const variant = options.variant || 'default';
    const theme = options.theme || 'light';
    const triggerAttrs = interactive
      ? ' type="button" data-global-search-trigger aria-label="Open global search"'
      : ' type="button" tabindex="-1" aria-hidden="true"';
    const themeCls = theme === 'dark' ? ' tma-overview--dark' : '';
    const brandIcon = variant === 'layout'
      ? `<img src="${avatarSrc('AvatarByewind')}" alt="" width="24" height="24" />`
      : `<img src="${iconUrl('DefaultIcon')}" alt="" width="24" height="24" />`;
    const headerIcons = variant === 'layout'
      ? `${overviewHeaderIcon('Sidebar')}${overviewHeaderIcon('Star')}${overviewHeaderIcon('Sun')}${overviewHeaderIcon('ClockCounterClockwise')}${overviewHeaderIcon('Bell')}${overviewHeaderIcon('Rightbar')}`
      : `${overviewHeaderIcon('SidebarSimple')}${overviewHeaderIcon('SquaresFour')}${overviewHeaderIcon('Sun')}${overviewHeaderIcon('Bell')}${overviewHeaderIcon('ClockCounterClockwise')}`;
    const chartTitleA = variant === 'layout' ? 'Total Users' : 'Total Revenue';
    const chartTitleB = variant === 'layout' ? 'Traffic by Website' : 'Total Profit';
    const chartImageA = variant === 'layout' ? chartMotion : chartDonut;
    const chartImageB = variant === 'layout' ? chartDonut : chartMotion;
    const newUsersValue = variant === 'layout' ? '156' : '256';

    return `<div class="tma-overview${themeCls}" data-overview-theme="${theme}">
      <aside class="tma-overview__sidebar">
        <div class="tma-overview__brand">
          <div class="tma-overview__brand-mark" aria-hidden="true">${brandIcon}</div>
          <span class="tma-overview__brand-name">ByeWind</span>
        </div>
        <div class="tma-overview__nav-group-label">Favorites</div>
        ${overviewNavItem('Overview', 'ChartPie')}
        ${overviewNavItem('Projects', 'Folder')}
        <div class="tma-overview__nav-group-label">Dashboards</div>
        ${overviewNavItem('Overview', 'ChartPie', true)}
        ${overviewNavItem('Projects', 'Folder')}
      </aside>
      <header class="tma-overview__header">
        <div class="tma-overview__breadcrumb">Dashboards / <strong>Overview</strong></div>
        <div class="tma-overview__header-actions">
          <div class="tma-overview__header-icons">${headerIcons}</div>
          <button class="tma-overview__global-search"${triggerAttrs}>
            <img src="${iconUrl('Search16')}" alt="" class="tma-overview__global-search-icon" width="16" height="16" />
            <span class="tma-overview__global-search-text">Search</span>
            <span class="tma-overview__global-search-kbd">/</span>
          </button>
        </div>
      </header>
      <aside class="tma-overview__right-sidebar">
        ${renderOverviewRightbar(variant)}
      </aside>
      <main class="tma-overview__main">
        <div class="tma-overview__page-title">Overview</div>
        <div class="tma-overview__cards">
          <div class="tma-overview__card tma-overview__card--blue">
            <div class="tma-overview__card-label">Views</div>
            <div class="tma-overview__card-row">
              <div class="tma-overview__card-value">7,265</div>
              <div class="tma-overview__card-delta">+11.01% <img src="${iconUrl('ArrowRise')}" alt="" width="16" height="16" /></div>
            </div>
          </div>
          <div class="tma-overview__card tma-overview__card--purple">
            <div class="tma-overview__card-label">Visits</div>
            <div class="tma-overview__card-row">
              <div class="tma-overview__card-value">3,671</div>
              <div class="tma-overview__card-delta">-0.03% <img src="${iconUrl('ArrowFall')}" alt="" width="16" height="16" /></div>
            </div>
          </div>
          <div class="tma-overview__card tma-overview__card--blue">
            <div class="tma-overview__card-label">New Users</div>
            <div class="tma-overview__card-row">
              <div class="tma-overview__card-value">${newUsersValue}</div>
              <div class="tma-overview__card-delta">+15.03% <img src="${iconUrl('ArrowRise')}" alt="" width="16" height="16" /></div>
            </div>
          </div>
          <div class="tma-overview__card tma-overview__card--purple">
            <div class="tma-overview__card-label">Active Users</div>
            <div class="tma-overview__card-row">
              <div class="tma-overview__card-value">2,318</div>
              <div class="tma-overview__card-delta">+6.08% <img src="${iconUrl('ArrowRise')}" alt="" width="16" height="16" /></div>
            </div>
          </div>
        </div>
        <div class="tma-overview__charts">
          <div class="tma-overview__chart">
            <div class="tma-overview__chart-title">${chartTitleA}</div>
            <div class="tma-overview__chart-body"><img src="${chartImageA}" alt="" /></div>
          </div>
          <div class="tma-overview__chart">
            <div class="tma-overview__chart-title">${chartTitleB}</div>
            <div class="tma-overview__chart-body"><img src="${chartImageB}" alt="" /></div>
          </div>
        </div>
      </main>
    </div>`;
  }

  function renderRow(item, options = {}) {
    const { size = 'compact', query = '', selected = false, interactive = false, index = 0 } = options;
    const tag = interactive ? 'button' : 'div';
    const selectedCls = selected ? ' tma-search-popup__row--selected' : '';
    const interactiveCls = interactive ? ' tma-search-popup__row--interactive' : '';
    const attrs = interactive
      ? ` type="button" data-search-result data-result-index="${index}"`
      : '';

    let iconMarkup = '';
    if (item.type === 'user' && item.avatar) {
      iconMarkup = `<img src="${avatarSrc(item.avatar)}" alt="" class="tma-search-popup__row-avatar" width="24" height="24" />`;
    } else if (item.type === 'query' || item.icon === 'search') {
      iconMarkup = `<img src="${iconUrl('Search16')}" alt="" class="tma-search-popup__row-icon" width="16" height="16" />`;
    } else if (item.type === 'page') {
      iconMarkup = `<img src="${iconUrl('FileText')}" alt="" class="tma-search-popup__row-icon" width="16" height="16" />`;
    } else {
      iconMarkup = `<img src="${iconUrl('User')}" alt="" class="tma-search-popup__row-icon" width="16" height="16" />`;
    }

    const label = item.label || item.title || '';
    let textHtml = '';
    if (item.subtitle) {
      const sub = item.subtitle;
      const match = query.toLowerCase();
      if (match && sub.toLowerCase().includes(match)) {
        const parts = sub.split(new RegExp(`(${query})`, 'i'));
        textHtml = `<div class="tma-search-popup__row-main tma-search-popup__row-main--stack">${iconMarkup}<div><div class="tma-search-popup__row-text">${escapeHtml(item.title)}</div><div class="tma-search-popup__row-subtext">${parts.map(p => (p.toLowerCase() === match.toLowerCase() ? `<span class="tma-search-popup__highlight">${escapeHtml(p)}</span>` : escapeHtml(p))).join('')}</div></div></div>`;
      } else {
        textHtml = `<div class="tma-search-popup__row-main tma-search-popup__row-main--stack">${iconMarkup}<div><div class="tma-search-popup__row-text">${escapeHtml(item.title)}</div><div class="tma-search-popup__row-subtext">${escapeHtml(sub)}</div></div></div>`;
      }
    } else {
      textHtml = `<div class="tma-search-popup__row-main">${iconMarkup}<span class="tma-search-popup__row-text">${splitHighlight(label, query)}</span></div>`;
    }

    const hint = (item.enterHint || selected)
      ? `<span class="tma-search-popup__row-hint">↩︎</span>`
      : '';

    return `<${tag} class="tma-search-popup__row${selectedCls}${interactiveCls}"${attrs}>${textHtml}${hint}</${tag}>`;
  }

  function getDesignDemoInitialItems() {
    return [
      { type: 'query', label: 'Landing page design' },
      { type: 'user', label: 'ByeWind', avatar: 'AvatarByewind', selected: true },
      { type: 'page', label: 'Overview', icon: 'search', navId: 'dash-project-overview' },
      { type: 'user', label: 'ByeWind', avatar: 'AvatarByewind', navId: 'up-overview' },
      { type: 'user', label: 'Emma Smith', avatar: 'Avatar3d04', navId: 'clients' },
      { type: 'user', label: 'Melody Macy', avatar: 'AvatarFemale05', navId: 'clients' },
    ];
  }

  function renderInitialBody(options = {}) {
    const { interactive = false, designDemo = false } = options;
    if (!designDemo) {
      return '<div class="tma-search-popup__empty">No recent searches</div>';
    }
    const items = getDesignDemoInitialItems();
    const recent = items.slice(0, 2);
    const visited = items.slice(2, 3);
    const contacts = items.slice(3);
    let rowIndex = 0;

    const group = (title, groupItems) => {
      const rows = groupItems.map((item) => {
        const row = renderRow(item, {
          selected: item.selected,
          interactive,
          index: rowIndex,
        });
        rowIndex += 1;
        return row;
      }).join('');
      return `<div class="tma-search-popup__group"><div class="tma-search-popup__group-label">${title}</div>${rows}</div>`;
    };

    return group('Recent search', recent) + group('Recently visited', visited) + group('Clients', contacts);
  }

  function renderResultsBody(query, items, options = {}) {
    const { interactive = false, selectedIndex = 1 } = options;
    const countLabel = `<div class="tma-search-popup__group-label">${items.length >= 5 ? '105 results' : `${items.length} results`}</div>`;
    const rows = items.map((item, i) => renderRow(item, {
      size: 'compact',
      query,
      selected: i === selectedIndex,
      interactive,
      index: i,
      enterHint: i === selectedIndex,
    })).join('');
    return `<div class="tma-search-popup__group">${countLabel}${rows}</div>`;
  }

  function renderPopup(options = {}) {
    const {
      variant = 'compact',
      state = 'initial',
      query = '',
      interactive = false,
      standalone = false,
      sidebarEmbed = false,
      showScrollbar = false,
      selectedIndex = 0,
      loading = false,
      nodeId = '',
    } = options;

    const sizeCls = variant === 'large' ? 'tma-search-popup--large' : 'tma-search-popup--compact';
    const standaloneCls = standalone ? ' tma-search-popup--standalone' : '';
    const sidebarCls = sidebarEmbed ? ' tma-search-popup--sidebar' : '';
    const previewCls = showScrollbar ? ' tma-search-popup--preview-results' : '';
    const nodeAttr = nodeId ? ` data-node-id="${nodeId}"` : '';
    const popupRole = sidebarEmbed ? 'search' : 'dialog';
    const modalAttr = sidebarEmbed ? '' : ' aria-modal="true"';
    const rootAttrs = interactive
      ? ` data-search-popup role="${popupRole}" aria-label="Search"${modalAttr}${nodeAttr}`
      : nodeAttr;

    const iconSize = 24;
    const searchIcon = iconMarkup('Search', 'tma-search-popup__search-icon', iconSize, iconSize);

    let inputAttrs = interactive ? ' data-search-input autocomplete="off" spellcheck="false"' : ' readonly tabindex="-1"';
    let inputValue = '';
    let caret = '';

    if (state === 'results') {
      inputValue = query || 'Wind';
    } else if (state === 'empty') {
      inputValue = query || 'zzzz';
    }

    if (!inputValue) {
      inputAttrs += ' placeholder="Search"';
      if (state === 'initial' && !interactive) {
        caret = '<span class="tma-search-popup__caret" aria-hidden="true">|</span>';
      }
    }

    let trailing = '';
    if (state === 'results') {
      trailing = `<button type="button" class="tma-search-popup__clear"${interactive ? ' data-search-clear aria-label="Clear search"' : ' tabindex="-1"'}>${iconMarkup('XCircle', '', 24, 24)}</button>`;
    } else if (state === 'empty' || loading) {
      trailing = `<span class="tma-search-popup__spinner-btn" aria-hidden="true">${iconMarkup('Loading', 'tma-search-popup__spinner', 24, 24)}</span>`;
    }

    let dismissBtn = '';
    if (sidebarEmbed && interactive) {
      dismissBtn = `<button type="button" class="tma-search-popup__dismiss" data-search-dismiss aria-label="Close search">${iconMarkup('X', '', 24, 24)}</button>`;
    }

    const designDemo = !!options.designDemo;
    let body = '';
    if (state === 'initial') {
      body = renderInitialBody({ interactive, designDemo });
    } else if (state === 'results') {
      const items = designDemo ? [
        { type: 'user', label: 'ByeWind', avatar: 'AvatarByewind' },
        { type: 'user', label: 'ByeWind', match: query || 'Wind' },
        { type: 'page', title: 'Overview', subtitle: "I'm ByeWind, a Product UX/UI Designer, based in China. ", match: query || 'Wind' },
        { type: 'page', label: "ByeWind's profile", match: query || 'Wind' },
        { type: 'page', label: 'Farewell to Wind', match: query || 'Wind' },
        { type: 'page', label: 'https://twitter.com/FarewelltoWind', match: query || 'Wind' },
      ] : [];
      body = items.length
        ? renderResultsBody(query || 'Wind', items, { interactive, selectedIndex: 1 })
        : '<div class="tma-search-popup__empty">No results</div>';
    } else if (state === 'empty') {
      body = '<div class="tma-search-popup__empty">No results</div>';
    }

    const scrollbar = showScrollbar ? '<div class="tma-search-popup__scrollbar" aria-hidden="true"></div>' : '';

    return `<div class="tma-search-popup ${sizeCls}${standaloneCls}${sidebarCls}${previewCls}"${rootAttrs}>
      <div class="tma-search-popup__header">
        <div class="tma-search-popup__field">
          ${searchIcon}
          ${caret}<input type="text" class="tma-search-popup__input" value="${escapeHtml(inputValue)}"${inputAttrs} />
        </div>
        ${trailing}
        ${dismissBtn}
      </div>
      <div class="tma-search-popup__body" data-search-body>${body}</div>
      ${scrollbar}
    </div>`;
  }

  function renderScene(options = {}) {
    const { interactive = false, popupOpen = true, popupState = 'initial' } = options;
    const sceneCls = interactive ? ' tma-global-search-scene--interactive' : '';
    const maskCls = popupOpen ? '' : ' style="display:none"';
    const popup = popupOpen
      ? renderPopup({ variant: 'compact', state: popupState, interactive, designDemo: true })
      : '';

    return `<div class="tma-global-search-scene${sceneCls}" data-global-search-scene>
      <div class="tma-global-search-scene__canvas" data-scene-canvas>
        ${renderOverview({ interactive })}
        <div class="tma-global-search-scene__mask" data-search-backdrop${maskCls} aria-hidden="true"></div>
        ${popup}
      </div>
    </div>`;
  }

  function filterIndex(index, query) {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return index.filter(item => {
      const hay = [
        item.label,
        item.title,
        item.subtitle,
        ...(item.keywords || []),
      ].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    });
  }

  function updatePopupSearchTrailing(popup, options) {
    if (!popup) return;
    const header = popup.querySelector('.tma-search-popup__header');
    if (!header) return;
    const dismiss = header.querySelector('.tma-search-popup__dismiss');
    header.querySelector('.tma-search-popup__clear, .tma-search-popup__spinner-btn')?.remove();
    let node = null;
    if (options.loading) {
      const temp = document.createElement('div');
      temp.innerHTML = `<span class="tma-search-popup__spinner-btn" aria-hidden="true">${iconMarkup('Loading', 'tma-search-popup__spinner', 24, 24)}</span>`;
      node = temp.firstChild;
    } else if (options.showClear) {
      const temp = document.createElement('div');
      temp.innerHTML = `<button type="button" class="tma-search-popup__clear" data-search-clear aria-label="Clear search">${iconMarkup('XCircle', '', 24, 24)}</button>`;
      node = temp.firstChild;
    }
    if (node) {
      if (dismiss) header.insertBefore(node, dismiss);
      else header.appendChild(node);
    }
  }

  function showToast(message) {
    let toast = document.querySelector('[data-global-search-toast]');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'tma-global-search-toast';
      toast.setAttribute('data-global-search-toast', '');
      toast.setAttribute('role', 'status');
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('tma-global-search-toast--visible');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => toast.classList.remove('tma-global-search-toast--visible'), 2200);
  }

  function updateSceneScale(scene) {
    const canvas = scene.querySelector('[data-scene-canvas]');
    if (!canvas) return;
    const scale = scene.clientWidth / 1440;
    scene.style.setProperty('--scene-scale', String(scale));
  }

  function mountInteractiveScene(root, index, options = {}) {
    const startOpen = options.startOpen !== false;
    const searchIndex = index && index.length ? index : DESIGN_DEMO_INDEX;
    root.innerHTML = renderScene({ interactive: true, popupOpen: startOpen, popupState: 'initial' });
    const scene = root.querySelector('[data-global-search-scene]');
    updateSceneScale(scene);

    const state = {
      open: startOpen,
      query: '',
      selectedIndex: 0,
      loading: false,
      results: [],
    };

    function popupEl() {
      return scene.querySelector('[data-search-popup]');
    }

    function inputEl() {
      return scene.querySelector('[data-search-input]');
    }

    function closePopup() {
      state.open = false;
      state.query = '';
      state.selectedIndex = 0;
      state.loading = false;
      state.results = [];
      const popup = popupEl();
      if (popup) popup.remove();
      const mask = scene.querySelector('[data-search-backdrop]');
      if (mask) mask.style.display = 'none';
    }

    function handleInitialSelect(item) {
      if (!item) return;
      if (item.type === 'query') {
        state.query = item.label;
        runSearch(item.label);
        return;
      }
      if (item.navId) {
        navigateResult(item);
        return;
      }
      if (item.label) runSearch(item.label);
    }

    function renderLivePopup() {
      let popup = popupEl();
      const mask = scene.querySelector('[data-search-backdrop]');
      if (mask) mask.style.display = '';

      const q = state.query.trim();
      let stateName = 'initial';
      if (state.loading) stateName = 'empty';
      else if (q && state.results.length === 0 && q.length > 1) stateName = 'empty';
      else if (q && state.results.length) stateName = 'results';

      const html = renderPopup({
        variant: 'compact',
        state: stateName,
        query: q,
        interactive: true,
        designDemo: true,
        selectedIndex: state.selectedIndex,
        loading: state.loading,
      });

      if (popup) {
        popup.outerHTML = html;
      } else {
        scene.querySelector('[data-scene-canvas]').insertAdjacentHTML('beforeend', html);
      }

      popup = popupEl();
      const input = inputEl();
      if (input) {
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      }

      bindPopupEvents(popup);
      refreshInteractiveBody(popup, stateName, q);
    }

    function refreshInteractiveBody(popup, stateName, q) {
      const body = popup.querySelector('[data-search-body]');
      if (!body) return;

      if (stateName === 'initial') {
        body.innerHTML = renderInitialBody({ interactive: true, designDemo: true });
        bindInitialBodyEvents(body, { onInitialSelect: handleInitialSelect });
        return;
      }

      if (stateName === 'empty' && !state.loading) {
        body.innerHTML = '<div class="tma-search-popup__empty">No results</div>';
        return;
      }

      if (stateName === 'results') {
        body.innerHTML = renderResultsBody(q, state.results, {
          interactive: true,
          selectedIndex: state.selectedIndex,
        });
        body.querySelectorAll('[data-search-result]').forEach((btn, i) => {
          btn.addEventListener('click', (e) => navigateResult(state.results[i], e));
        });
      }
    }

    function openPopup() {
      state.open = true;
      renderLivePopup();
    }

    function runSearch(query) {
      state.query = query;
      state.loading = false;
      if (!query.trim()) {
        state.results = [];
        renderLivePopup();
        return;
      }

      state.results = filterIndex(searchIndex, query);
      state.selectedIndex = state.results.length ? 0 : 0;
      renderLivePopup();
    }

    function navigateResult(item, event) {
      if (!item) return;
      const newTab = event && (event.metaKey || event.ctrlKey);
      const href = item.href || '#';
      if (newTab) {
        showToast(`Opened ${item.label || item.title} in a new tab`);
        window.open(href, '_blank');
      } else {
        showToast(`Navigated to ${item.label || item.title}`);
        closePopup();
      }
    }

    function bindPopupEvents(popup) {
      if (!popup) return;
      const input = popup.querySelector('[data-search-input]');

      input?.addEventListener('input', () => {
        clearTimeout(state._debounce);
        const query = input.value;
        state.loading = query.length > 0;
        updatePopupSearchTrailing(popup, { loading: state.loading, showClear: false });
        state._debounce = setTimeout(() => runSearch(query), 120);
      });

      popup.addEventListener('click', (e) => {
        if (!e.target.closest('[data-search-clear]')) return;
        e.preventDefault();
        clearTimeout(state._debounce);
        state.query = '';
        state.results = [];
        state.selectedIndex = 0;
        state.loading = false;
        renderLivePopup();
      });

      popup.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          closePopup();
          return;
        }

        const count = state.results.length;
        if (!count) return;

        if (e.key === 'ArrowDown') {
          e.preventDefault();
          state.selectedIndex = Math.min(state.selectedIndex + 1, count - 1);
          refreshInteractiveBody(popup, 'results', state.query.trim());
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          state.selectedIndex = Math.max(state.selectedIndex - 1, 0);
          refreshInteractiveBody(popup, 'results', state.query.trim());
        } else if (e.key === 'Enter') {
          e.preventDefault();
          navigateResult(state.results[state.selectedIndex], e);
        }
      });
    }

    scene.querySelector('[data-global-search-trigger]')?.addEventListener('click', openPopup);
    scene.querySelector('[data-search-backdrop]')?.addEventListener('click', closePopup);

    if (startOpen) {
      bindPopupEvents(popupEl());
    }

    document.addEventListener('keydown', (e) => {
      // A tag-name test misses contenteditable fields — the Messages composer
      // is one, so typing a URL there opened this instead of inserting the
      // slash, and every following keystroke went to the search box.
      const active = document.activeElement;
      const editing =
        /input|textarea|select/i.test(active?.tagName || '') || !!active?.isContentEditable;

      if (e.key === '/' && !state.open && !editing) {
        e.preventDefault();
        openPopup();
      }
      if (e.key === 'Escape' && state.open) closePopup();
    });

    new ResizeObserver(() => updateSceneScale(scene)).observe(scene);
  }

  function bindInitialBodyEvents(body, handlers) {
    if (!body || !handlers) return;
    const items = getDesignDemoInitialItems();
    body.querySelectorAll('[data-search-result]').forEach((btn) => {
      const index = Number(btn.getAttribute('data-result-index'));
      btn.addEventListener('click', () => handlers.onInitialSelect(items[index]));
    });
  }

  function mountSearchController(mount, options = {}) {
    const overlay = options.overlay || null;
    const sidebarEmbed = !!options.sidebarEmbed;
    const index = DEFAULT_INDEX.concat(options.index || window.TMAGlobalSearchIndex || []);
    if (!mount) return null;

    const state = {
      open: false,
      query: '',
      selectedIndex: 0,
      loading: false,
      results: [],
    };

    function popupEl() {
      return mount.querySelector('[data-search-popup]');
    }

    function inputEl() {
      return mount.querySelector('[data-search-input]');
    }

    function close() {
      state.open = false;
      state.query = '';
      state.selectedIndex = 0;
      state.loading = false;
      state.results = [];
      mount.innerHTML = '';
      if (overlay) overlay.hidden = true;
      if (typeof options.onClose === 'function') options.onClose();
    }

    function navigateResult(item, event) {
      if (!item) return;
      if (typeof options.onNavigate === 'function') {
        options.onNavigate(item, event);
      } else if (item.href && item.href.startsWith('http')) {
        window.open(item.href, event && (event.metaKey || event.ctrlKey) ? '_blank' : '_self');
      }
      close();
    }

    function handleInitialSelect(item) {
      if (!item) return;
      if (item.type === 'query') {
        state.query = item.label;
        runSearch(item.label);
        return;
      }
      if (item.navId) {
        navigateResult(item);
        return;
      }
      if (item.label) {
        runSearch(item.label);
      }
    }

    function bindPopupEvents(popup) {
      if (!popup) return;
      const input = popup.querySelector('[data-search-input]');
      const dismiss = popup.querySelector('[data-search-dismiss]');

      input?.addEventListener('input', () => {
        clearTimeout(state._debounce);
        const query = input.value;
        state.loading = query.length > 0;
        updatePopupSearchTrailing(popup, { loading: state.loading, showClear: false });
        state._debounce = setTimeout(() => runSearch(query), 120);
      });

      popup.addEventListener('click', (e) => {
        if (e.target.closest('[data-search-clear]')) {
          e.preventDefault();
          clearTimeout(state._debounce);
          state.query = '';
          state.results = [];
          state.selectedIndex = 0;
          state.loading = false;
          renderLivePopup();
          return;
        }
        if (e.target.closest('[data-search-dismiss]')) {
          close();
        }
      });

      popup.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          close();
          return;
        }

        const count = state.results.length;
        if (!count) return;

        if (e.key === 'ArrowDown') {
          e.preventDefault();
          state.selectedIndex = Math.min(state.selectedIndex + 1, count - 1);
          refreshInteractiveBody(popup, 'results', state.query.trim());
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          state.selectedIndex = Math.max(state.selectedIndex - 1, 0);
          refreshInteractiveBody(popup, 'results', state.query.trim());
        } else if (e.key === 'Enter') {
          e.preventDefault();
          navigateResult(state.results[state.selectedIndex], e);
        }
      });
    }

    function refreshInteractiveBody(popup, stateName, q) {
      const body = popup.querySelector('[data-search-body]');
      if (!body) return;

      if (stateName === 'initial') {
        body.innerHTML = renderInitialBody({ interactive: true });
        bindInitialBodyEvents(body, { onInitialSelect: handleInitialSelect });
        return;
      }

      if (stateName === 'empty' && !state.loading) {
        body.innerHTML = '<div class="tma-search-popup__empty">No results</div>';
        return;
      }

      if (stateName === 'results') {
        body.innerHTML = renderResultsBody(q, state.results, {
          interactive: true,
          selectedIndex: state.selectedIndex,
        });
        body.querySelectorAll('[data-search-result]').forEach((btn, i) => {
          btn.addEventListener('click', (e) => navigateResult(state.results[i], e));
        });
      }
    }

    function renderLivePopup(renderOpts = {}) {
      const q = state.query.trim();
      let stateName = 'initial';
      if (state.loading) stateName = 'empty';
      else if (q && state.results.length === 0 && q.length > 1) stateName = 'empty';
      else if (q && state.results.length) stateName = 'results';

      mount.innerHTML = renderPopup({
        variant: 'compact',
        state: stateName,
        query: q,
        interactive: true,
        standalone: !sidebarEmbed,
        sidebarEmbed,
        selectedIndex: state.selectedIndex,
        loading: state.loading,
        nodeId: sidebarEmbed ? '' : '33257:43316',
      });

      const popup = popupEl();
      const input = inputEl();
      if (input && !renderOpts.skipFocus) {
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      }

      bindPopupEvents(popup);
      refreshInteractiveBody(popup, stateName, q);
    }

    function runSearch(query, renderOpts = {}) {
      state.query = query;
      state.loading = false;
      if (!query.trim()) {
        state.results = [];
        renderLivePopup(renderOpts);
        return;
      }

      state.results = filterIndex(index, query);
      state.selectedIndex = state.results.length ? 0 : 0;
      renderLivePopup(renderOpts);
    }

    function open(openOpts = {}) {
      state.open = true;
      if (overlay) overlay.hidden = false;
      if (openOpts.query != null && String(openOpts.query).length) {
        runSearch(String(openOpts.query), openOpts);
        return;
      }
      state.query = '';
      state.selectedIndex = 0;
      state.loading = false;
      state.results = [];
      renderLivePopup(openOpts);
    }

    if (overlay) {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) close();
      });
    }

    return { open, close, isOpen: () => state.open, search: runSearch };
  }

  function mountDashboardSearch(root, options = {}) {
    const overlay = root.querySelector('[data-cmd]');
    const mount = root.querySelector('[data-dash-search-mount]');
    if (!overlay || !mount) return null;
    return mountSearchController(mount, Object.assign({}, options, { overlay }));
  }

  function mountSidebarSearch(mount, options = {}) {
    if (!mount) return null;
    return mountSearchController(mount, Object.assign({}, options, { sidebarEmbed: true }));
  }

  window.TMAGlobalSearch = {
    icons,
    iconUrl,
    assetPath,
    renderOverview,
    renderPopup,
    renderScene,
    renderInitialBody,
    renderResultsBody,
    mountInteractiveScene,
    mountDashboardSearch,
    mountSidebarSearch,
    mountSearchController,
    updateSceneScale,
    filterIndex,
    highlightText,
  };

  document.querySelectorAll('[data-global-search-live]').forEach((el) => {
    mountInteractiveScene(el, window.TMAGlobalSearchIndex || DESIGN_DEMO_INDEX);
  });
})();
