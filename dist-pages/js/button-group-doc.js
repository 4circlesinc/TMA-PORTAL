/* TMA — Button Group documentation (Figma 33067:4918) */
(function () {
  'use strict';

  const ICON_TOOLBAR = [
    { key: 'sun', icon: 'SunDuotone20', label: 'Tooltip', shortcut: '⌘T' },
    { key: 'history', icon: 'ClockCounterClockwiseDuotone20', label: 'Tooltip', shortcut: '⌘A' },
    { key: 'bell', icon: 'BellDuotone20', label: 'Tooltip', shortcut: '⌘N' },
    { key: 'sidebar', icon: 'SidebarDuotone20', label: 'Tooltip', shortcut: '⌘R' },
  ];

  function di(key, cls, w, h) {
    return (window.TMAButtonGroupDocIcons && window.TMAButtonGroupDocIcons.svg(key, cls, w, h)) || '';
  }

  function esc(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderPaginationGroup() {
    const pages = ['1', '2', '3', '4', '5'];
    const pageBtns = pages.map((page, i) => {
      const active = i === 0 ? ' tma-button-group-doc__page-btn--active' : '';
      return `<button type="button" class="tma-button-group-doc__page-btn${active}" data-page="${page}" aria-pressed="${i === 0 ? 'true' : 'false'}">${esc(page)}</button>`;
    }).join('');
    return `<div class="tma-button-group-doc__group tma-button-group-doc__group--pagination" data-node-id="33067:4925" role="group" aria-label="Pagination">
      ${pageBtns}
      <button type="button" class="tma-button-group-doc__page-btn tma-button-group-doc__page-btn--icon" data-action="prev" aria-label="Previous page">${di('CaretLeft16', 'tma-button-group-doc__page-icon', 16, 16)}</button>
      <button type="button" class="tma-button-group-doc__page-btn tma-button-group-doc__page-btn--icon" data-action="next" aria-label="Next page">${di('CaretRight16', 'tma-button-group-doc__page-icon', 16, 16)}</button>
    </div>`;
  }

  function renderIconToolbar() {
    const items = ICON_TOOLBAR.map((item) => `
      <button type="button" class="tma-button-group-doc__icon-btn" aria-label="${esc(item.label)}">
        <span class="tma-button-group-doc__icon-btn-icon">${di(item.icon, 'tma-button-group-doc__icon-btn-svg', 20, 20)}</span>
        <span class="tma-button-group-doc__tooltip" role="tooltip">
          <span class="tma-button-group-doc__tooltip-label">${esc(item.label)}</span>
          <span class="tma-button-group-doc__tooltip-shortcut">${esc(item.shortcut)}</span>
        </span>
      </button>`).join('');
    return `<div class="tma-button-group-doc__group tma-button-group-doc__group--icons" data-node-id="33067:4926" role="group">${items}</div>`;
  }

  function renderAuthGroup() {
    return `<div class="tma-button-group-doc__group tma-button-group-doc__group--auth" data-node-id="33067:4927" role="group">
      <button type="button" class="tma-button-group-doc__pill-btn tma-button-group-doc__pill-btn--grey">Sign up</button>
      <button type="button" class="tma-button-group-doc__pill-btn tma-button-group-doc__pill-btn--filled">Sign in</button>
    </div>`;
  }

  function renderNavGroup() {
    return `<div class="tma-button-group-doc__group tma-button-group-doc__group--nav" data-node-id="33067:4928" role="group">
      <button type="button" class="tma-button-group-doc__nav-btn tma-button-group-doc__nav-btn--grey">
        <span class="tma-button-group-doc__nav-btn-icon">${di('ChevronLeft20', 'tma-button-group-doc__nav-btn-svg', 20, 20)}</span>
        <span class="tma-button-group-doc__nav-btn-label">Previous</span>
      </button>
      <button type="button" class="tma-button-group-doc__nav-btn tma-button-group-doc__nav-btn--filled">Submit</button>
    </div>`;
  }

  function renderSocialGroup() {
    return `<div class="tma-button-group-doc__group tma-button-group-doc__group--social" data-node-id="33067:4929" role="group">
      <button type="button" class="tma-button-group-doc__brand-btn tma-button-group-doc__brand-btn--google" aria-label="Sign in with Google">${di('Google24White', 'tma-button-group-doc__brand-icon', 24, 24)}</button>
      <button type="button" class="tma-button-group-doc__brand-btn tma-button-group-doc__brand-btn--apple" aria-label="Sign in with Apple">${di('Apple24White', 'tma-button-group-doc__brand-icon', 24, 24)}</button>
      <button type="button" class="tma-button-group-doc__brand-btn tma-button-group-doc__brand-btn--facebook" aria-label="Sign in with Facebook">${di('Facebook24White', 'tma-button-group-doc__brand-icon', 24, 24)}</button>
    </div>`;
  }

  function renderExamples() {
    return `<div class="tma-button-group-doc__examples-stack" data-node-id="33067:4924">
      ${renderPaginationGroup()}
      ${renderIconToolbar()}
      ${renderAuthGroup()}
      ${renderNavGroup()}
      ${renderSocialGroup()}
    </div>`;
  }

  function renderDocumentationFooter(socialSvg) {
    const ts = socialSvg || (() => '');
    return `<footer class="tma-button-group-doc__footer" data-node-id="33067:4930">
      <div class="tma-button-group-doc__footer-brand">
        <div class="tma-button-group-doc__logo" aria-hidden="true">
          ${ts('TMALogoMark', 'tma-button-group-doc__logo-icon', 28, 28)}
          <span class="tma-button-group-doc__wordmark">
            ${ts('TMALogoWordmark', 'tma-button-group-doc__wordmark-left', 53, 12)}
            ${ts('TMALogoSuffix', 'tma-button-group-doc__wordmark-right', 15, 12)}
          </span>
        </div>
        <p class="tma-button-group-doc__copyright">© 2026 TM ANTOINE Advisory. All rights reserved.</p>
      </div>
      <div class="tma-button-group-doc__socials">
        <a class="tma-button-group-doc__social-link" href="https://twitter.com/FarewelltoWind" target="_blank" rel="noopener noreferrer" aria-label="Twitter">${ts('TwitterSocial', '', 28, 28)}</a>
        <a class="tma-button-group-doc__social-link" href="https://www.instagram.com/farewelltowind" target="_blank" rel="noopener noreferrer" aria-label="Instagram">${ts('InstagramSocial', '', 28, 28)}</a>
        <a class="tma-button-group-doc__social-link" href="https://www.threads.net/@farewelltowind" target="_blank" rel="noopener noreferrer" aria-label="Threads">${ts('ThreadsLogo', '', 28, 28)}</a>
        <a class="tma-button-group-doc__social-link" href="https://dribbble.com/byewind" target="_blank" rel="noopener noreferrer" aria-label="Dribbble">${ts('DribbbleSocial', '', 28, 28)}</a>
        <a class="tma-button-group-doc__social-link" href="https://www.behance.net/ByeWind" target="_blank" rel="noopener noreferrer" aria-label="Behance">${ts('BehanceSocial', '', 28, 28)}</a>
        <a class="tma-button-group-doc__social-link" href="https://www.figma.com/@byewind" target="_blank" rel="noopener noreferrer" aria-label="Figma">${ts('FigmaSocial', '', 28, 28)}</a>
        <a class="tma-button-group-doc__social-link" href="#" target="_blank" rel="noopener noreferrer" aria-label="Website">${ts('TMALogoMark', '', 28, 28)}</a>
      </div>
    </footer>`;
  }

  function wirePagination(root) {
    const group = root.querySelector('.tma-button-group-doc__group--pagination');
    if (!group) return;

    const pageButtons = () => Array.from(group.querySelectorAll('[data-page]'));

    function setActive(btn) {
      pageButtons().forEach((item) => {
        item.classList.remove('tma-button-group-doc__page-btn--active');
        item.setAttribute('aria-pressed', 'false');
      });
      btn.classList.add('tma-button-group-doc__page-btn--active');
      btn.setAttribute('aria-pressed', 'true');
    }

    group.addEventListener('click', (event) => {
      const target = event.target.closest('button');
      if (!target || !group.contains(target)) return;

      if (target.dataset.page) {
        setActive(target);
        return;
      }

      const buttons = pageButtons();
      const currentIndex = buttons.findIndex((btn) => btn.classList.contains('tma-button-group-doc__page-btn--active'));
      if (target.dataset.action === 'prev' && currentIndex > 0) {
        setActive(buttons[currentIndex - 1]);
      }
      if (target.dataset.action === 'next' && currentIndex < buttons.length - 1) {
        setActive(buttons[currentIndex + 1]);
      }
    });
  }

  function wireDocumentationInteractivity(root) {
    if (!root) return;
    wirePagination(root);
  }

  function mountDocumentation(opts) {
    const o = opts || {};
    if (o.examplesEl) {
      o.examplesEl.innerHTML = renderExamples();
      wireDocumentationInteractivity(o.examplesEl);
    }
    if (o.footerEl && o.socialSvg) o.footerEl.innerHTML = renderDocumentationFooter(o.socialSvg);
  }

  window.TMAButtonGroupDoc = {
    ICON_TOOLBAR,
    renderExamples,
    renderDocumentationFooter,
    wireDocumentationInteractivity,
    mountDocumentation,
  };
})();
